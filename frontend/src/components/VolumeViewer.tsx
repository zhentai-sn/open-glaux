import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { annotation, ToolGroupManager } from "@cornerstonejs/tools";

import { Enums, RenderingEngine, csReady, type Types } from "../viewer/cornerstone";
import {
  niftiReady,
  preloadNiftiDims,
  loadNiftiVolume,
  invalidateNiftiVolume,
} from "../viewer/nifti";
import { activateTool, createToolGroup, csToolsReady, destroyToolGroup } from "../viewer/csTools";
import { api, ApiError } from "../api/client";
import { loadAnnotations } from "../annotation/bridge";
import { attachCsAnnoBridge, niftiTarget, resetCsAnnoBridge, syncCsAnnotations } from "../annotation/csAnno";
import { useSession } from "../store/session";
import type { ClassSpec, Primitive } from "../api/types";

// VolumeViewer（P6 楔子，SDD 04 T6 迁移）——CS3D StackViewport 视 NIfTI 为 z-stack。
//
// 统一框架收编：
// - brush 参数（mode/class/radius）与 WW/WL 迁 store.toolOptions（选项条在 ViewerChrome）；
// - 逐切片 bbox/polygon 经 csAnno 桥落 /annotations（带 z；imageId 含 #z= 天然按层隔离）；
// - CT brush 提交**仍走** POST /volume/{id}/mask-edit（D-13：labelmap 是任务结果不是标注），
//   宿主为 overlay 自持笔迹缓冲（spike3 退化方案：CS3D segmentation 在 stack 未打通）；
// - 滚轮切 z（ZoomTool wheel 关闭，activateTool wheelZoom=false）；
// - labelmap 叠色保留现有 canvas 渲染（CS3D segmentation 原生渲染随 spike3 一并留后）。

const VP_ID = "glaux-stack-vol";
const RE_ID = "glaux-re-vol";
const TG_ID = "glaux-tg-vol";
const OVERLAY_ALPHA = 0.4; // labelmap 叠色透明度

type VolPrim = Extract<Primitive, { kind: "volume_mask" }>;
type LabelVol = { columns: number; rows: number; slices: number; raw: Int32Array };

export function VolumeViewer() {
  const elRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const vpRef = useRef<Types.IStackViewport | null>(null);
  const labelVolRef = useRef<LabelVol | null>(null);
  const editMaskRef = useRef<Uint8Array | null>(null); // 当前 z 的画笔笔迹（cols*rows）
  const drawingRef = useRef(false);
  const editSeqRef = useRef(0); // 前端请求序号：只接受最新一次响应
  const baseSeqRef = useRef(0); // 后端乐观并发 base_seq（成功编辑后跟随服务端 seq）
  const zImageIdRef = useRef<string | null>(null); // 当前 z 的 nifti imageId（csAnno 桥用）

  const [ready, setReady] = useState(false);
  const [numSlices, setNumSlices] = useState(0);
  const [z, setZ] = useState(0);
  const [busy, setBusy] = useState(false);

  const activeVolume = useSession((s) => s.activeVolume);
  const primitives = useSession((s) => s.primitives);
  const annotations = useSession((s) => s.annotations);
  const tasks = useSession((s) => s.tasks);
  const modality = useSession((s) => s.modality);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const { ww, wl } = toolOptions.voi;
  const { mode: brushMode, classId: brushClass, radius } = toolOptions.brush;

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const capabilities = taskView?.capabilities ?? [];
  const volPrim = useMemo<VolPrim | null>(() => {
    const vol = primitives.find((p): p is VolPrim => p.kind === "volume_mask");
    return vol ?? null;
  }, [primitives]);
  const classes = volPrim?.classes ?? null;
  const classById = useMemo(() => {
    const m = new Map<number, ClassSpec>();
    for (const c of classes ?? []) m.set(c.class_id, c);
    return m;
  }, [classes]);

  // --- overlay 绘制（图例 + z 计数 + labelmap 叠色 + 画笔笔迹） ----------------
  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const el = elRef.current;
    const vp = vpRef.current;
    if (!ov || !el) return;
    const r = el.getBoundingClientRect();
    if (ov.width !== Math.round(r.width) || ov.height !== Math.round(r.height)) {
      ov.width = Math.round(r.width);
      ov.height = Math.round(r.height);
    }
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);

    // 1) labelmap 叠色（当前 z 切片，按 class 上色，worldToCanvas 对齐 CT）
    const lv = labelVolRef.current;
    if (lv && vp && z < lv.slices) {
      const { columns, rows } = lv;
      const sliceLen = columns * rows;
      const slice = lv.raw.subarray(z * sliceLen, (z + 1) * sliceLen);
      const off = document.createElement("canvas");
      off.width = columns;
      off.height = rows;
      const octx = off.getContext("2d")!;
      const img = octx.createImageData(columns, rows);
      const edit = editMaskRef.current;
      for (let i = 0; i < sliceLen; i++) {
        const cid = slice[i];
        let rgb: [number, number, number] | null = null;
        if (cid > 0) {
          const cls = classById.get(cid);
          rgb = cls ? _hexToRgb(cls.color) : [255, 80, 80];
        }
        // 画笔笔迹：paint 高亮当前 class 色，erase 高亮红
        if (edit && edit[i]) {
          rgb = brushMode === "erase" ? [255, 60, 60] : _hexToRgb(classById.get(brushClass)?.color ?? "#ffffff");
        }
        const o = i * 4;
        if (rgb) {
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255;
        } else {
          img.data[o + 3] = 0;
        }
      }
      octx.putImageData(img, 0, 0);
      // 对齐：像素 (0,0)→世界 (0,0,0)，(cols,rows)→(cols,rows,0)（metaProvider 用单位 spacing + 零 IPP）
      const tl = vp.worldToCanvas([0, 0, 0] as Types.Point3);
      const br = vp.worldToCanvas([columns, rows, 0] as Types.Point3);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = OVERLAY_ALPHA;
      ctx.drawImage(off, 0, 0, columns, rows, tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      ctx.globalAlpha = 1;
    }

    // 2) 图例（class 颜色 + 双语标签）
    if (classes) {
      const legendX = 12;
      let legendY = ov.height - 12 - classes.length * 18;
      ctx.font = "11px ui-monospace,monospace";
      ctx.textAlign = "left";
      for (const c of classes) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(legendX, legendY, 12, 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(230,234,240,0.95)";
        ctx.fillText(`${c.label.zh} (class_id=${c.class_id})`, legendX + 18, legendY + 10);
        legendY += 18;
      }
    }

    // 3) z 计数
    if (numSlices > 0) {
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.font = "bold 12px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(`z ${z + 1} / ${numSlices}`, ov.width - 12, 20);
    }
    // 4) 画笔提交中指示
    if (busy) {
      ctx.fillStyle = "rgba(79,176,255,0.95)";
      ctx.font = "11px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText("…", ov.width - 12, 36);
    }
  }, [classes, classById, z, numSlices, brushMode, brushClass, busy]);

  // drawOverlay 每渲染都换新引用（deps 多）——用 ref 持最新，供异步/事件回调调用，
  // 避免把它放进数据加载 effect 的 deps（否则加载中途被 cleanup cancel，labelmap 永远设不上）。
  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  // 一次性 init CS3D + nifti loader + tools + StackViewport + 标注事件桥
  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | null = null;
    (async () => {
      await csReady();
      await niftiReady();
      await csToolsReady();
      if (disposed || !elRef.current) return;
      const engine = new RenderingEngine(RE_ID);
      engine.enableElement({ viewportId: VP_ID, type: Enums.ViewportType.STACK, element: elRef.current });
      engineRef.current = engine;
      vpRef.current = engine.getViewport(VP_ID) as Types.IStackViewport;
      createToolGroup(TG_ID, VP_ID, RE_ID);
      detach = attachCsAnnoBridge({ getImageId: () => zImageIdRef.current, toTarget: niftiTarget });
      // 相机变化（缩放/平移）→ 重绘 overlay 保持对齐
      const el = elRef.current;
      const onCam = () => drawOverlayRef.current();
      el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      (el as unknown as { _glauxOnCam?: () => void })._glauxOnCam = onCam;
      setReady(true);
    })();
    return () => {
      disposed = true;
      detach?.();
      destroyToolGroup(TG_ID);
      resetCsAnnoBridge();
      const el = elRef.current as unknown as { _glauxOnCam?: () => void } | null;
      if (el?._glauxOnCam) elRef.current?.removeEventListener(Enums.Events.CAMERA_MODIFIED, el._glauxOnCam);
      try {
        engineRef.current?.destroy();
      } catch {
        /* noop */
      }
      engineRef.current = null;
      vpRef.current = null;
    };
  }, []);

  // --- store.tool → ToolGroup（brush 走自持缓冲不激活 CS3D；滚轮留给切 z）------
  useEffect(() => {
    if (!ready) return;
    const tg = ToolGroupManager.getToolGroup(TG_ID);
    if (!tg) return;
    activateTool(tg, tool === "brush" ? "cursor" : tool, capabilities, toolOptions, modality, { wheelZoom: false });
  }, [ready, tool, toolOptions, capabilities, modality]);

  // 切 volume → 建每帧一个 imageId 的 stack + 设 numSlices
  useEffect(() => {
    if (!ready || !activeVolume) return;
    const vp = vpRef.current;
    if (!vp) return;
    // 切卷先重置：避免旧 z / 旧 label / 旧标注泄漏到新卷
    setNumSlices(0);
    setZ(0);
    labelVolRef.current = null;
    editMaskRef.current = null;
    baseSeqRef.current = 0;
    zImageIdRef.current = null;
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* noop */
    }
    resetCsAnnoBridge();
    const baseUrl = api.volumeUrl(activeVolume);
    let cancelled = false;
    (async () => {
      const dim = await preloadNiftiDims(`nifti:${baseUrl}`);
      if (cancelled) return;
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      const mid = Math.floor(dim.slices / 2);
      const ids = Array.from({ length: dim.slices }, (_, i) => `nifti:${baseUrl}#z=${i}`);
      await vp.setStack(ids, mid);
      vp.resetCamera();
      vp.render();
      setNumSlices(dim.slices);
      setZ(mid);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, activeVolume]);

  // primitives 变（跑分割/编辑回流）→ 拉 labelmap 整卷入 ref → 重绘
  // 只依赖 labelmap URL——不依赖 drawOverlay，否则初始 z/numSlices 变化会反复 cancel 加载。
  const labelRef = volPrim?.ref ?? null;
  useEffect(() => {
    if (!labelRef) {
      labelVolRef.current = null;
      drawOverlayRef.current();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const vol = await loadNiftiVolume(labelRef);
        if (cancelled) return;
        labelVolRef.current = { columns: vol.columns, rows: vol.rows, slices: vol.slices, raw: vol.raw };
        // 自动跳到器官体素最多的 z——否则默认中间层可能是空切片（demo CT 器官集中在一端），
        // 用户切到 CT 却看不到分割。
        const sliceLen = vol.columns * vol.rows;
        let bestZ = -1, bestCount = 0;
        for (let zz = 0; zz < vol.slices; zz++) {
          let c = 0;
          const base = zz * sliceLen;
          for (let i = 0; i < sliceLen; i++) if (vol.raw[base + i] > 0) c++;
          if (c > bestCount) { bestCount = c; bestZ = zz; }
        }
        if (bestZ >= 0) setZ(bestZ);
      } catch {
        labelVolRef.current = null; // labelmap 404/未就绪 → 空白不抛
      }
      drawOverlayRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [labelRef]);

  // z 变化 → 切 imageIdIndex + 清笔迹 + 拉该层标注（bbox/polygon 逐切片隔离）+ 重绘
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || numSlices <= 0 || !activeVolume) return;
    editMaskRef.current = null;
    const baseUrl = api.volumeUrl(activeVolume);
    zImageIdRef.current = `nifti:${baseUrl}#z=${z}`;
    // 旧 z 的 CS3D 标注清场（映射复位，store 回灌 effect 会按新 z 重建）
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* noop */
    }
    resetCsAnnoBridge();
    void loadAnnotations(activeVolume, z);
    (async () => {
      try {
        await vp.setImageIdIndex(z);
        vp.render();
      } catch {
        /* 静默回退 */
      }
      drawOverlay();
    })();
  }, [z, numSlices, activeVolume, drawOverlay]);

  // store.annotations → CS3D 标注层回灌（仅当前 z 的 bbox/polygon）
  useEffect(() => {
    if (!ready || !zImageIdRef.current) return;
    const vp = vpRef.current;
    const forId = (vp as unknown as { getFrameOfReferenceId?: () => string })?.getFrameOfReferenceId?.() ?? "GLAUX_CT";
    syncCsAnnotations(annotations, zImageIdRef.current, forId, VP_ID);
  }, [annotations, ready, z]);

  // 窗宽窗位 → cornerstone voiRange（HU 空间：[wl-ww/2, wl+ww/2]）——真相源 store.toolOptions.voi。
  // 依赖 numSlices/activeVolume：切卷后 setStack→resetCamera 会重置 VOI 到 image 默认，
  // 故卷就绪后重跑此 effect，把当前 WW/WL 重新贴上。
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || numSlices <= 0) return;
    try {
      vp.setProperties({ voiRange: { lower: wl - ww / 2, upper: wl + ww / 2 } });
      vp.render();
    } catch {
      /* VOI 设置瞬态（卷切换中）静默 */
    }
  }, [ww, wl, numSlices, activeVolume]);

  // 元素尺寸变化 → engine.resize + overlay 重绘
  useEffect(() => {
    if (!ready || !elRef.current) return;
    const el = elRef.current;
    const ro = new ResizeObserver(() => {
      const engine = engineRef.current;
      const vp = vpRef.current;
      if (!engine || !vp || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        engine.resize(true, false);
        vp.render();
      } catch {
        /* 尺寸瞬态 */
      }
      drawOverlay();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, drawOverlay]);

  // 滚轮切 z（ZoomTool wheel 已在 activateTool 关闭；事件从 CS3D canvas 冒泡上来）
  const onWheel = (e: React.WheelEvent) => {
    if (numSlices <= 0) return;
    const dz = e.deltaY > 0 ? 1 : -1;
    setZ((cur) => Math.max(0, Math.min(numSlices - 1, cur + dz)));
  };

  // --- 画笔：pointer → 图像像素 → 笔迹 mask（自持缓冲；提交走 mask-edit，D-13）---
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const vp = vpRef.current;
      const lv = labelVolRef.current;
      const ov = overlayRef.current;
      if (!vp || !lv || !ov) return;
      const rect = ov.getBoundingClientRect();
      const world = vp.canvasToWorld([clientX - rect.left, clientY - rect.top] as Types.Point2);
      const col = Math.round(world[0]);
      const row = Math.round(world[1]);
      const { columns, rows } = lv;
      if (!editMaskRef.current) editMaskRef.current = new Uint8Array(columns * rows);
      const mask = editMaskRef.current;
      const rad = radius;
      const erase = brushMode === "erase";
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
          mask[y * columns + x] = erase ? 0 : 1;
        }
      }
      drawOverlay();
    },
    [radius, brushMode, drawOverlay],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== "brush" || busy) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    paintAt(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    paintAt(e.clientX, e.clientY);
  };
  const onPointerUp = async () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const mask = editMaskRef.current;
    const lv = labelVolRef.current;
    if (!mask || !lv || !activeVolume || !volPrim) return;
    if (!mask.some((v) => v)) return;

    // 笔迹 → 二值 PNG（white=编辑区，与后端 convert("L")→bool 对齐）
    const png = _maskToPng(mask, lv.columns, lv.rows);
    const st = useSession.getState();
    const mySeq = ++editSeqRef.current;
    setBusy(true);
    try {
      const resp = await api.volumeMaskEdit(activeVolume, {
        task: "totalseg_liver_kidney",
        method: "totalsegmentator_v2",
        base_seq: baseSeqRef.current,
        slices: [{ z, class_id: brushClass, mode: brushMode, mask_png_ref: png }],
      });
      if (mySeq !== editSeqRef.current) return; // 被更新的编辑取代，丢弃过期响应
      baseSeqRef.current = resp.seq;
      st.setMetrics(resp.metrics);
      // labelmap 已在服务端变更 → 失效缓存 + 重拉当前卷 label + 清笔迹 + 重绘
      invalidateNiftiVolume(volPrim.ref);
      editMaskRef.current = null;
      const vol = await loadNiftiVolume(volPrim.ref);
      labelVolRef.current = { columns: vol.columns, rows: vol.rows, slices: vol.slices, raw: vol.raw };
      drawOverlay();
    } catch (err) {
      if (mySeq !== editSeqRef.current) return;
      // 失败回滚：丢弃本地笔迹（服务端未变），提示用户（Notice 胶囊）
      editMaskRef.current = null;
      drawOverlay();
      const msg = err instanceof ApiError && err.status === 409
        ? "编辑冲突：labelmap 已被其他编辑超越，请刷新后重试"
        : "画笔编辑未生效（后端失败），已丢弃本次修正";
      st.notify("crit", msg);
    } finally {
      setBusy(false);
    }
  };

  const brushActive = tool === "brush";
  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }} onWheel={onWheel}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} />
      {/* brush 态 overlay 拦指针（自持缓冲）；其余态放行给 CS3D 工具层（bbox/polygon/pan） */}
      <canvas
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          cursor: brushActive ? "crosshair" : "default",
          pointerEvents: brushActive ? "auto" : "none",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function _hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 二值笔迹 mask (cols*rows) → base64 PNG（white=编辑区，与后端 convert("L")→bool 对齐）。 */
function _maskToPng(mask: Uint8Array, columns: number, rows: number): string {
  const cv = document.createElement("canvas");
  cv.width = columns;
  cv.height = rows;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(columns, rows);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const v = mask[i] ? 255 : 0;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}
