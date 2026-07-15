import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Enums, RenderingEngine, csReady, type Types } from "../viewer/cornerstone";
import {
  niftiReady,
  preloadNiftiDims,
  loadNiftiVolume,
  invalidateNiftiVolume,
} from "../viewer/nifti";
import { api, ApiError } from "../api/client";
import { useSession } from "../store/session";
import type { ClassSpec, Measure, Primitive } from "../api/types";

// VolumeViewer（P6 楔子）——CS3D StackViewport 视 NIfTI 为 z-stack（3.33.5 无 3D VolumeViewport）。
//
// 关键差异 vs raster_2d：滚轮切 z（不是 zoom）；分割 labelmap 按 class 上色叠加在 CT 上；
// 画笔编辑走 POST /volume/{id}/mask-edit（服务端为准），沿用 CornerstoneViewer 的 editSeqRef
// 守卫 + 失败回滚 + note/crit 提示范式（不重蹈 IMT 覆辙）。

const VP_ID = "glaux-stack-vol";
const RE_ID = "glaux-re-vol";
const OVERLAY_ALPHA = 0.4; // labelmap 叠色透明度
const DEFAULT_RADIUS = 3; // 画笔半径（图像像素）

// CT 标准窗宽窗位预设（HU）——window width / level。voiRange 在 modality(HU) 空间，
// 因 nifti loader 提供 intercept/slope 把 stored→HU（见 viewer/nifti.ts）。
const CT_PRESETS = [
  { key: "abd", label: "腹部", ww: 400, wl: 40 },
  { key: "med", label: "纵隔", ww: 350, wl: 40 },
  { key: "lung", label: "肺", ww: 1500, wl: -600 },
  { key: "bone", label: "骨", ww: 1800, wl: 400 },
] as const;
const DEFAULT_WW = 400; // 腹部软组织窗（与 nifti.ts image 默认一致）
const DEFAULT_WL = 40;

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

  const [ready, setReady] = useState(false);
  const [numSlices, setNumSlices] = useState(0);
  const [z, setZ] = useState(0);
  const [brushOn, setBrushOn] = useState(false);
  const [brushClass, setBrushClass] = useState(1);
  const [brushMode, setBrushMode] = useState<"paint" | "erase">("erase");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [busy, setBusy] = useState(false);
  const [ww, setWw] = useState(DEFAULT_WW); // 窗宽（HU）
  const [wl, setWl] = useState(DEFAULT_WL); // 窗位（HU）

  const activeVolume = useSession((s) => s.activeVolume);
  const primitives = useSession((s) => s.primitives);
  const metrics = useSession((s) => s.metrics);
  const tasks = useSession((s) => s.tasks);
  const modality = useSession((s) => s.modality);

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
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
        // 画笔笔迹：paint 高亮当前 class 色，erase 高亮红叉
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
  }, [classes, classById, z, numSlices, brushMode, brushClass]);

  // drawOverlay 每渲染都换新引用（deps 多）——用 ref 持最新，供异步/事件回调调用，
  // 避免把它放进数据加载 effect 的 deps（否则加载中途被 cleanup cancel，labelmap 永远设不上）。
  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  // 一次性 init CS3D + nifti loader + StackViewport
  useEffect(() => {
    let disposed = false;
    (async () => {
      await csReady();
      await niftiReady();
      if (disposed || !elRef.current) return;
      const engine = new RenderingEngine(RE_ID);
      engine.enableElement({ viewportId: VP_ID, type: Enums.ViewportType.STACK, element: elRef.current });
      engineRef.current = engine;
      vpRef.current = engine.getViewport(VP_ID) as Types.IStackViewport;
      // 相机变化（缩放/平移）→ 重绘 overlay 保持对齐
      const el = elRef.current;
      const onCam = () => drawOverlayRef.current();
      el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      (el as unknown as { _glauxOnCam?: () => void })._glauxOnCam = onCam;
      setReady(true);
    })();
    return () => {
      disposed = true;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切 volume → 建每帧一个 imageId 的 stack + 设 numSlices
  useEffect(() => {
    if (!ready || !activeVolume) return;
    const vp = vpRef.current;
    if (!vp) return;
    // 切卷先重置：避免旧 z / 旧 label 泄漏到新卷
    setNumSlices(0);
    setZ(0);
    labelVolRef.current = null;
    editMaskRef.current = null;
    baseSeqRef.current = 0;
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

  // z 变化 → 切 imageIdIndex + 清笔迹 + 重绘
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || numSlices <= 0) return;
    editMaskRef.current = null;
    (async () => {
      try {
        await vp.setImageIdIndex(z);
        vp.render();
      } catch {
        /* 静默回退 */
      }
      drawOverlay();
    })();
  }, [z, numSlices, drawOverlay]);

  // 窗宽窗位 → cornerstone voiRange（HU 空间：[wl-ww/2, wl+ww/2]）。
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

  const onWheel = (e: React.WheelEvent) => {
    if (numSlices <= 0) return;
    e.preventDefault();
    const dz = e.deltaY > 0 ? 1 : -1;
    setZ((cur) => Math.max(0, Math.min(numSlices - 1, cur + dz)));
  };

  // --- 画笔：pointer → 图像像素 → 笔迹 mask ---------------------------------
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
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
          mask[y * columns + x] = 1;
        }
      }
      drawOverlay();
    },
    [radius, drawOverlay],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!brushOn || busy) return;
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
      // 失败回滚：丢弃本地笔迹（服务端未变），提示用户（note/crit，纯文本不经 Rich）
      editMaskRef.current = null;
      drawOverlay();
      const msg = err instanceof ApiError && err.status === 409
        ? "编辑冲突：labelmap 已被其他编辑超越，请刷新后重试"
        : "画笔编辑未生效（后端失败），已丢弃本次修正";
      st.pushAgent({ variant: "note", tone: "crit", text: msg });
    } finally {
      setBusy(false);
    }
  };

  const cursor = brushOn ? "crosshair" : "grab";

  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} />
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor, touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {/* 顶部信息条 */}
      <div style={_infoBarStyle}>
        {taskView?.label.zh ?? "—"} · {activeVolume ?? "—"}
        {metrics && Object.keys(metrics).length > 0 && (
          <>
            {" · "}
            {Object.entries(metrics)
              .filter(([k]) => k.endsWith("_volume_mm3"))
              .map(([k, m]: [string, Measure]) => `${k.replace("_volume_mm3", "")}: ${fmtVol(m.value)}`)
              .join(" · ")}
          </>
        )}
      </div>
      {/* 窗宽窗位工具条（CT 显示基本设置）——预设 + WW/WL 手动微调 */}
      {numSlices > 0 && (
        <div style={_voiBarStyle}>
          {CT_PRESETS.map((p) => {
            const active = p.ww === ww && p.wl === wl;
            return (
              <button
                key={p.key}
                onClick={() => { setWw(p.ww); setWl(p.wl); }}
                title={`WW ${p.ww} / WL ${p.wl}`}
                style={{ ..._btn, background: active ? "#6a3fb0" : "rgba(60,60,70,0.9)" }}
              >
                {p.label}
              </button>
            );
          })}
          <span style={_voiSep} />
          <label style={_voiLabel}>
            WW
            <input type="range" min={1} max={3000} step={10} value={ww}
              onChange={(e) => setWw(Number(e.target.value))} style={{ width: 84 }} />
            <span className="mono" style={{ width: 34, textAlign: "right" }}>{ww}</span>
          </label>
          <label style={_voiLabel}>
            WL
            <input type="range" min={-1000} max={1000} step={10} value={wl}
              onChange={(e) => setWl(Number(e.target.value))} style={{ width: 84 }} />
            <span className="mono" style={{ width: 40, textAlign: "right" }}>{wl}</span>
          </label>
        </div>
      )}
      {/* 画笔工具条 */}
      {classes && classes.length > 0 && (
        <div style={_toolbarStyle}>
          <button
            onClick={() => setBrushOn((v) => !v)}
            style={{ ..._btn, background: brushOn ? "#4FB0FF" : "rgba(60,60,70,0.9)" }}
          >
            {brushOn ? "画笔 ✓" : "画笔"}
          </button>
          {brushOn && (
            <>
              {(["erase", "paint"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setBrushMode(m)}
                  style={{ ..._btn, background: brushMode === m ? "#FF8A5B" : "rgba(60,60,70,0.9)" }}
                >
                  {m === "erase" ? "擦" : "画"}
                </button>
              ))}
              <select
                value={brushClass}
                onChange={(e) => setBrushClass(Number(e.target.value))}
                style={_select}
              >
                {classes.map((c) => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.label.zh}
                  </option>
                ))}
              </select>
              <label style={{ color: "#e6eaf0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                r{radius}
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  style={{ width: 60 }}
                />
              </label>
              {busy && <span style={{ color: "#4FB0FF", fontSize: 11 }}>…</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function fmtVol(mm3: number): string {
  if (Math.abs(mm3) >= 1000) return `${(mm3 / 1000).toFixed(1)} cm³`;
  return `${mm3.toFixed(1)} mm³`;
}

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

const _infoBarStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  background: "rgba(20,20,20,0.65)",
  color: "rgba(230,234,240,0.95)",
  padding: "6px 10px",
  borderRadius: 6,
  font: "12px ui-monospace,monospace",
  pointerEvents: "none",
};

const _toolbarStyle: React.CSSProperties = {
  position: "absolute",
  right: 12,
  top: 12,
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(20,20,20,0.75)",
  padding: "6px 8px",
  borderRadius: 6,
};

const _voiBarStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 12,
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(20,20,20,0.75)",
  padding: "6px 10px",
  borderRadius: 6,
};

const _voiSep: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "rgba(230,234,240,0.2)",
};

const _voiLabel: React.CSSProperties = {
  color: "#e6eaf0",
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const _btn: React.CSSProperties = {
  color: "#e6eaf0",
  border: "none",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const _select: React.CSSProperties = {
  background: "rgba(60,60,70,0.9)",
  color: "#e6eaf0",
  border: "none",
  borderRadius: 4,
  padding: "3px 4px",
  fontSize: 11,
};
