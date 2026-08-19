import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OpenSeadragon, makeWsiTileSource, makeWsiViewer } from "../viewer/openseadragon";
import { api } from "../api/client";
import { runWsiTask } from "../data/actions";
import { useSession } from "../store/session";
import type { ClassSpec, Primitive } from "../api/types";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// WsiViewer（P7 楔子）——OpenSeadragon 深缩放 + ROI 框选 + 核质心 overlay。
//
// 关键差异 vs raster_2d/volume_3d：瓦片按需（DZI 金字塔，永不整片下发）；深缩放（不是切 z）；
// 核检测按**框选 ROI**推理（整片不可行）。质心存 level-0 px，overlay 经 imageToViewerElement 跟随。
// 坐标三套：level-0 px（真相）↔ DeepZoom level（瓦片路由，OSD 内部）↔ OSD viewport（渲染）。

const NUCLEUS_R = 2.5; // 质心点半径（CSS px）
const MIN_ROI = 24; // 最小 ROI 边长（level-0 px）——防误触极小框

type PointSetPrim = Extract<Primitive, { kind: "point_set" }>;

export function WsiViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const drawRef = useRef<{ x0: number; y0: number; x1: number; y1: number; on: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [verify, setVerify] = useState<{ f1: number; count_pred: number; count_ref: number } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const activeSlide = useSession((s) => s.activeSlide);
  const imageMeta = useSession((s) => s.imageMeta);
  const primitives = useSession((s) => s.primitives);
  const metrics = useSession((s) => s.metrics);
  const tool = useSession((s) => s.tool);
  const tasks = useSession((s) => s.tasks);
  const modality = useSession((s) => s.modality);
  const wsiRoi = useSession((s) => s.wsiRoi);
  const loading = useSession((s) => s.loading);
  const setTool = useSession((s) => s.setTool);
  const notify = useSession((s) => s.notify);

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const pointSet = useMemo<PointSetPrim | null>(
    () => primitives.find((p): p is PointSetPrim => p.kind === "point_set") ?? null,
    [primitives],
  );
  const classById = useMemo(() => {
    const m = new Map<number, ClassSpec>();
    for (const c of pointSet?.classes ?? []) m.set(c.class_id, c);
    return m;
  }, [pointSet]);
  const dims = imageMeta?.dims ?? null;

  // --- overlay 绘制（核质心 + ROI 框 + 计数）——所有坐标经 OSD imageToViewerElement 换算 ------
  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const el = containerRef.current;
    const viewer = viewerRef.current;
    if (!ov || !el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) {
      ov.width = Math.round(w * dpr);
      ov.height = Math.round(h * dpr);
    }
    const ctx = ov.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!viewer || !viewer.world.getItemCount()) return;
    const vp = viewer.viewport;

    // 1) 核质心（level-0 px → 元素 CSS px），按 class 上色
    if (pointSet) {
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < pointSet.points.length; i++) {
        const [ix, iy] = pointSet.points[i];
        const p = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(ix, iy));
        if (p.x < -4 || p.y < -4 || p.x > w + 4 || p.y > h + 4) continue; // 视口外裁剪
        const cid = pointSet.point_class_ids[i] ?? 1;
        ctx.fillStyle = classById.get(cid)?.color ?? "#7BE0AD";
        ctx.beginPath();
        ctx.arc(p.x, p.y, NUCLEUS_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 2) 已跑的 ROI 框（level-0 px → 元素 px）
    if (wsiRoi) {
      const tl = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(wsiRoi[0], wsiRoi[1]));
      const br = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(wsiRoi[2], wsiRoi[3]));
      ctx.strokeStyle = "rgba(123,224,173,0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.setLineDash([]);
    }

    // 3) 正在拖的框（元素 px，直接画）
    const d = drawRef.current;
    if (d && d.on) {
      ctx.strokeStyle = "rgba(255,180,90,0.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    // 4) 计数
    if (pointSet) {
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.font = "bold 12px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${pointSet.points.length} 核`, w - 12, 20);
    }
  }, [pointSet, classById, wsiRoi]);

  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  // 一次性 init OSD + 绑视口更新重绘
  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = makeWsiViewer(containerRef.current);
    viewerRef.current = viewer;
    const redraw = () => drawOverlayRef.current();
    viewer.addHandler("update-viewport", redraw);
    viewer.addHandler("animation", redraw);
    viewer.addHandler("open", redraw);
    setReady(true);
    return () => {
      try {
        viewer.destroy();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, []);

  // 切 slide / 有 dims → open 新 tileSource
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !activeSlide || !dims) return;
    viewer.open(makeWsiTileSource(activeSlide, dims[0], dims[1]));
  }, [ready, activeSlide, dims]);

  // 元素尺寸变化 → 重绘 overlay
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => drawOverlayRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // primitives / ROI 变 → 重绘
  useEffect(() => {
    drawOverlayRef.current();
  }, [pointSet, wsiRoi, drawOverlay]);

  // --- ROI 框选（仅 tool==="roi" 时 overlay 拦截指针；否则 OSD 处理平移/缩放）----------
  const elPoint = (e: React.PointerEvent): [number, number] => {
    const rect = containerRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== "roi" || loading) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = elPoint(e);
    drawRef.current = { x0: x, y0: y, x1: x, y1: y, on: true };
    drawOverlay();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d || !d.on) return;
    const [x, y] = elPoint(e);
    d.x1 = x;
    d.y1 = y;
    drawOverlay();
  };
  const onPointerUp = async () => {
    const d = drawRef.current;
    const viewer = viewerRef.current;
    if (!d || !d.on || !viewer || !activeSlide || !dims) return;
    d.on = false;
    const vp = viewer.viewport;
    // 元素 px → level-0 image px（两角）
    const a = vp.viewerElementToImageCoordinates(new OpenSeadragon.Point(d.x0, d.y0));
    const b = vp.viewerElementToImageCoordinates(new OpenSeadragon.Point(d.x1, d.y1));
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    const x0 = clamp(Math.round(Math.min(a.x, b.x)), dims[0]);
    const y0 = clamp(Math.round(Math.min(a.y, b.y)), dims[1]);
    const x1 = clamp(Math.round(Math.max(a.x, b.x)), dims[0]);
    const y1 = clamp(Math.round(Math.max(a.y, b.y)), dims[1]);
    drawRef.current = null;
    if (x1 - x0 < MIN_ROI || y1 - y0 < MIN_ROI) {
      drawOverlay();
      notify("info", "ROI 太小，请拖一个更大的框（≥24px）");
      return;
    }
    setTool("cursor"); // 框完切回平移，避免误画
    const ok = await runWsiTask(activeSlide, [x0, y0, x1, y1]);
    if (!ok) {
      notify("crit", "核检测未产出（隔离环境不可用或子进程失败）");
    }
    drawOverlay();
  };

  const onVerify = async () => {
    if (!activeSlide || verifying) return;
    setVerifying(true);
    try {
      const r = await api.wsiVerify(activeSlide);
      setVerify({ f1: r.f1, count_pred: r.count_pred, count_ref: r.count_ref });
    } catch {
      notify("crit", "复现验证不可用（缺 reference 或隔离环境）");
    } finally {
      setVerifying(false);
    }
  };
  const f1Color = verify ? (verify.f1 >= 0.95 ? "#7BE0AD" : verify.f1 >= 0.85 ? "#FFC85A" : "#FF6B6B") : "#aaa";

  const cursor = tool === "roi" ? "crosshair" : "default";
  const overlayPointer = tool === "roi" ? "auto" : "none";
  const density = metrics?.nuclei_density_mm2?.value;
  const area = metrics?.roi_area_mm2?.value;

  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }} />
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor, pointerEvents: overlayPointer, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {/* 信息条 */}
      <div style={_infoBar}>
        {taskView?.label.zh ?? "—"} · {activeSlide ?? "—"}
        {imageMeta?.mpp_um && ` · ${imageMeta.mpp_um[0].toFixed(3)} µm/px`}
        {typeof density === "number" && ` · ${density.toFixed(0)} 核/mm²`}
        {typeof area === "number" && ` · ROI ${area.toFixed(3)} mm²`}
      </div>
      {/* 复现验证（右上） */}
      <div style={_verifyBox}>
        <button onClick={onVerify} disabled={verifying} style={_verifyBtn}>
          {verifying ? "验证中…" : "复现验证"}
        </button>
        {verify && (
          <span style={{ color: f1Color, font: "12px ui-monospace,monospace" }}>
            F1 {verify.f1.toFixed(2)} ({verify.count_pred}/{verify.count_ref})
          </span>
        )}
      </div>
      {/* 提示 / 状态 */}
      {loading ? (
        <div style={{ ..._hint, color: "#4FB0FF" }}><Icon icon={ICONS.spinner} size="sm" className="spin" /> 核检测中…（ROI 抽块 + StarDist 推理）</div>
      ) : (
        !pointSet && (
          <div style={_hint}>
            {tool === "roi" ? "在切片上拖一个框，松开即检测细胞核" : "选工具栏「框选 ROI」，再在切片上拖框检测"}
          </div>
        )
      )}
    </div>
  );
}

const _infoBar: React.CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  background: "rgba(20,20,20,0.65)",
  color: "rgba(230,234,240,0.95)",
  padding: "6px 10px",
  borderRadius: 6,
  font: "12px ui-monospace,monospace",
  pointerEvents: "none",
  zIndex: 2,
};

const _verifyBox: React.CSSProperties = {
  position: "absolute",
  right: 12,
  top: 12,
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(20,20,20,0.7)",
  padding: "5px 8px",
  borderRadius: 6,
  zIndex: 2,
};

const _verifyBtn: React.CSSProperties = {
  color: "#e6eaf0",
  background: "rgba(60,60,70,0.9)",
  border: "none",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const _hint: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  background: "rgba(20,20,20,0.75)",
  color: "rgba(230,234,240,0.9)",
  padding: "6px 12px",
  borderRadius: 6,
  font: "12px ui-monospace,monospace",
  pointerEvents: "none",
  zIndex: 2,
};
