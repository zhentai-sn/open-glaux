import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { annotation, ToolGroupManager, utilities as csToolsUtils } from "@cornerstonejs/tools";

import { type Types } from "../viewer/cornerstone";
import { loadNiftiVolume, invalidateNiftiVolume } from "../viewer/nifti";
import { activateTool } from "../viewer/csTools";
import { editMaskSink } from "../viewer/maskSinks";
import { useBrushBuffer } from "../viewer/hooks/useBrushBuffer";
import { useCsStackEngine } from "../viewer/hooks/useCsStackEngine";
import { useOverlayCanvas } from "../viewer/hooks/useOverlayCanvas";
import { frameSourceFor } from "../viewer/frameSources";
import { loadAnnotations } from "../annotation/bridge";
import { resetCsAnnoBridge, syncCsAnnotations } from "../annotation/csAnno";
import { taskViewFor } from "../data/actions";
import { useSession } from "../store/session";
import type { EngineProps } from "./viewerProps";
import type { ClassSpec, Primitive } from "../api/types";

// VolumeViewer（P6 楔子，SDD 04 T6 迁移）——CS3D StackViewport 视 NIfTI 为 z-stack。
//
// 统一框架收编：
// - brush 参数（mode/class/radius）与 WW/WL 迁 store.toolOptions（选项条在 ViewerChrome）；
// - 逐切片 bbox/polygon 经 csAnno 桥落 /annotations（带 z；imageId 含 #z= 天然按层隔离）；
// - CT brush 经 editMaskSink 走 POST /objects/{id}/edits（D-13：labelmap 是任务结果不是标注），
//   宿主为 overlay 自持笔迹缓冲（spike3 退化方案：CS3D segmentation 在 stack 未打通）；
// - 滚轮切 z（ZoomTool wheel 关闭，activateTool wheelZoom=false）；
// - labelmap 叠色保留现有 canvas 渲染（CS3D segmentation 原生渲染随 spike3 一并留后）。

const VP_ID = "glaux-stack-vol";
const RE_ID = "glaux-re-vol";
const TG_ID = "glaux-tg-vol";
const OVERLAY_ALPHA = 0.4; // labelmap 叠色透明度

type VolPrim = Extract<Primitive, { kind: "volume_mask" }>;
type LabelVol = { columns: number; rows: number; slices: number; raw: Int32Array };

export function VolumeViewer({ object, focus }: EngineProps) {
  const zImageIdRef = useRef<string | null>(null); // 当前 z 的 nifti imageId（csAnno 桥用）
  const stackIdsRef = useRef<string[]>([]);
  const preferredZRef = useRef<{ objectId: string; z: number } | null>(null);
  const { elementRef: elRef, engineRef, viewportRef: vpRef, ready } = useCsStackEngine({
    renderingEngineId: RE_ID,
    viewportId: VP_ID,
    toolGroupId: TG_ID,
    nifti: true,
    getImageId: () => zImageIdRef.current,
    toTarget: () => {
      const focus = useSession.getState().focus;
      return { image_id: focus?.object_id ?? "", z: focus?.index.z ?? null };
    },
  });
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const labelVolRef = useRef<LabelVol | null>(null);
  const { buffer: editMaskRef, clear: clearBrush, paint: paintBrush } = useBrushBuffer();
  const drawingRef = useRef(false);

  const [numSlices, setNumSlices] = useState(0);
  const [busy, setBusy] = useState(false);

  const objectId = object.id;
  const z = focus.index.z ?? 0;
  const source = useMemo(() => frameSourceFor(object), [object]);
  const setIndex = useSession((s) => s.setIndex);
  const primitives = useSession((s) => s.primitives);
  const annotations = useSession((s) => s.annotations);
  const tasks = useSession((s) => s.tasks);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const { ww, wl } = toolOptions.voi;
  const { mode: brushMode, classId: brushClass, radius } = toolOptions.brush;

  const taskView = useMemo(() => taskViewFor({ tasks }, object), [tasks, object]);
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
  const maskSink = useMemo(() => {
    if (!taskView || !volPrim?.ref) return null;
    const labelRef = volPrim.ref;
    return editMaskSink({
      objectId,
      task: taskView,
      method: () => useSession.getState().activeModel ?? taskView.default_method,
      brush: () => {
        const { classId, mode } = useSession.getState().toolOptions.brush;
        return { classId, mode };
      },
      onSaved: async (response) => {
        useSession.getState().setMetrics(response.metrics);
        invalidateNiftiVolume(labelRef);
        clearBrush();
        const volume = await loadNiftiVolume(labelRef);
        labelVolRef.current = { columns: volume.columns, rows: volume.rows, slices: volume.slices, raw: volume.raw };
        drawOverlayRef.current();
      },
      notify: (message) => useSession.getState().notify("crit", message),
    });
  }, [objectId, taskView, volPrim?.ref, clearBrush]);

  // --- store.tool → ToolGroup（brush 走自持缓冲不激活 CS3D；滚轮留给切 z）------
  useEffect(() => {
    if (!ready) return;
    const tg = ToolGroupManager.getToolGroup(TG_ID);
    if (!tg) return;
    activateTool(tg, tool === "brush" ? "cursor" : tool, capabilities, toolOptions, { wheelZoom: false });
  }, [ready, tool, toolOptions, capabilities]);

  // 切 volume → 建每帧一个 imageId 的 stack + 设 numSlices
  useEffect(() => {
    if (!ready || !objectId) return;
    const vp = vpRef.current;
    if (!vp) return;
    // 切卷先重置：避免旧 z / 旧 label / 旧标注泄漏到新卷
    setNumSlices(0);
    const preferred = preferredZRef.current?.objectId === objectId ? preferredZRef.current.z : null;
    setIndex({ z: preferred ?? 0 });
    labelVolRef.current = null;
    clearBrush();
    zImageIdRef.current = null;
    stackIdsRef.current = [];
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* noop */
    }
    resetCsAnnoBridge();
    let cancelled = false;
    (async () => {
      const dim = await source.dims();
      const ids = await source.imageIds();
      if (cancelled) return;
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      const mid = Math.floor(dim.frames / 2);
      stackIdsRef.current = ids;
      await vp.setStack(ids, mid);
      if (cancelled) return;
      const preferred = preferredZRef.current?.objectId === objectId ? preferredZRef.current.z : null;
      const initialZ = preferred ?? mid;
      if (initialZ !== mid) await vp.setImageIdIndex(initialZ);
      if (cancelled) return;
      vp.resetCamera();
      vp.render();
      setNumSlices(dim.frames);
      const latestPreferred = preferredZRef.current?.objectId === objectId ? preferredZRef.current.z : null;
      setIndex({ z: latestPreferred ?? initialZ });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, objectId, source, clearBrush, setIndex]);

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
        if (bestZ >= 0) {
          preferredZRef.current = { objectId, z: bestZ };
          setIndex({ z: bestZ });
        }
      } catch {
        labelVolRef.current = null; // labelmap 404/未就绪 → 空白不抛
      }
      drawOverlayRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [labelRef, objectId, setIndex]);

  // z 变化 → 切 imageIdIndex + 清笔迹 + 拉该层标注（bbox/polygon 逐切片隔离）+ 重绘
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || numSlices <= 0 || !objectId) return;
    clearBrush();
    zImageIdRef.current = stackIdsRef.current[z] ?? null;
    // 旧 z 的 CS3D 标注清场（映射复位，store 回灌 effect 会按新 z 重建）
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* noop */
    }
    resetCsAnnoBridge();
    void loadAnnotations(objectId, z);
    (async () => {
      try {
        await vp.setImageIdIndex(z);
        vp.render();
      } catch {
        /* 静默回退 */
      }
      drawOverlayRef.current();
    })();
    // 依赖里不放 drawOverlay：它每次重渲染都换标识，会让本 effect 无关重跑，
    // 而开头的 removeAllAnnotations() 会把当前 z 已回灌/已画的标注整层清掉。
  }, [z, numSlices, objectId, clearBrush]);

  // store.annotations → CS3D 标注层回灌（仅当前 z 的 bbox/polygon）
  useEffect(() => {
    if (!ready || !zImageIdRef.current) return;
    const vp = vpRef.current;
    const forId = (vp as unknown as { getFrameOfReferenceUID?: () => string })?.getFrameOfReferenceUID?.() ?? "GLAUX_CT";
    if (syncCsAnnotations(annotations, zImageIdRef.current, forId, forId))
      csToolsUtils.triggerAnnotationRenderForViewportIds([VP_ID]);
  }, [annotations, ready, z]);

  // 窗宽窗位 → cornerstone voiRange（HU 空间：[wl-ww/2, wl+ww/2]）——真相源 store.toolOptions.voi。
  // 依赖 numSlices/objectId：切卷后 setStack→resetCamera 会重置 VOI 到 image 默认，
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
  }, [ww, wl, numSlices, objectId]);

  useOverlayCanvas(ready, elRef, engineRef, vpRef, drawOverlay);

  // 滚轮切 z（ZoomTool wheel 已在 activateTool 关闭；事件从 CS3D canvas 冒泡上来）
  const onWheel = (e: React.WheelEvent) => {
    if (numSlices <= 0) return;
    const dz = e.deltaY > 0 ? 1 : -1;
    setIndex({ z: Math.max(0, Math.min(numSlices - 1, z + dz)) });
  };

  // --- 画笔：pointer → 图像像素 → 笔迹 mask（自持缓冲；提交经 editMaskSink，D-13）---
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
      paintBrush(col, row, lv, radius, brushMode);
      drawOverlay();
    },
    [radius, brushMode, paintBrush, drawOverlay],
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
    if (!mask || !lv || !objectId || !maskSink) return;
    if (!mask.some((v) => v)) return;
    setBusy(true);
    try {
      await maskSink.commit(mask, lv, { z });
    } catch {
      clearBrush();
      drawOverlay();
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
