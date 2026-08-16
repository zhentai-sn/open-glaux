import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OpenSeadragon, makeWsiTileSource, makeWsiViewer } from "../viewer/openseadragon";
import { api } from "../api/client";
import { createAnnotation, loadAnnotations, patchAnnotation } from "../annotation/bridge";
import {
  annotationToW3c,
  initAnnotator,
  w3cToPrimitive,
  type OsdAnnotator,
  type W3cAnnotation,
} from "../annotation/wsiAnno";
import { useSession } from "../store/session";
import type { ClassSpec, Primitive } from "../api/types";

// WsiViewer（P7 楔子，SDD 04 T7 迁移）——OpenSeadragon 深缩放 + Annotorious 通用标注 + 核质心 overlay。
//
// 关键差异 vs raster_2d/volume_3d：瓦片按需（DZI 金字塔，永不整片下发）；深缩放（不是切 z）。
// bbox/polygon 绘制与顶点编辑由 Annotorious 承担；产物经 annotationBridge 落 /annotations，
// bbox 的 on_commit 核检测由后端派发（hook_result 回流 Detection 通道）——前端不再自持框选逻辑。
// 质心存 level-0 px，overlay 经 imageToViewerElement 跟随（只读展示，非标注）。

const NUCLEUS_R = 2.5; // 质心点半径（CSS px）

type PointSetPrim = Extract<Primitive, { kind: "point_set" }>;

export function WsiViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const annoRef = useRef<OsdAnnotator | null>(null);
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
  const annotations = useSession((s) => s.annotations);
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

    // 3) 计数
    if (pointSet) {
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.font = "bold 12px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${pointSet.points.length} 核`, w - 12, 20);
    }
  }, [pointSet, classById, wsiRoi]);

  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  // 一次性 init OSD + Annotorious + 绑视口更新重绘
  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = makeWsiViewer(containerRef.current);
    viewerRef.current = viewer;
    const anno = initAnnotator(viewer);
    annoRef.current = anno;
    anno.on("createAnnotation", (wa: W3cAnnotation) => {
      // W3C → 契约 → annotationBridge（乐观渲染 + 落库 + on_commit 钩子产物回流）
      const prim = w3cToPrimitive(wa);
      const slide = useSession.getState().activeSlide;
      if (!prim || !slide) return;
      void createAnnotation({ image_id: slide, primitive: prim }).then((saved) => {
        // 服务端落库成功后由 store 回灌 effect 用真 id 重渲染 Annotorious；
        // bbox 同步 wsiRoi（agent 上下文 roi_box / 重跑通道仍读它）
        if (saved && saved.primitive.kind === "bbox") {
          const b = saved.primitive;
          useSession.getState().setWsiRoi([b.x0, b.y0, b.x1, b.y1]);
        }
      });
    });
    anno.on("updateAnnotation", (wa: W3cAnnotation) => {
      const s = useSession.getState();
      const slide = s.activeSlide;
      if (!wa.id || !slide) return;
      const local = s.annotations.find((a) => a.id === wa.id);
      const prim = w3cToPrimitive(wa);
      if (!local || !prim) return;
      void patchAnnotation(local.id, local.seq, { primitive: prim });
    });
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

  // 切 slide / 有 dims → open 新 tileSource + 拉取该 slide 的标注
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !activeSlide || !dims) return;
    viewer.open(makeWsiTileSource(activeSlide, dims[0], dims[1]));
    void loadAnnotations(activeSlide);
  }, [ready, activeSlide, dims]);

  // store.annotations → Annotorious 渲染（唯一真相源回灌；临时 id 不下发避免与本地重复）
  useEffect(() => {
    const anno = annoRef.current;
    if (!anno) return;
    anno.setAnnotations(annotations.filter((a) => !a.id.startsWith("tmp-")).map(annotationToW3c).filter(Boolean));
  }, [annotations]);

  // 统一工具集合 → Annotorious 绘制态（bbox/polygon；brush 在 WSI 无能力位，ViewerChrome 已禁）
  useEffect(() => {
    const anno = annoRef.current;
    if (!anno) return;
    if (tool === "bbox") {
      anno.setDrawingTool("rectangle");
      anno.setDrawingEnabled(true);
    } else if (tool === "polygon") {
      anno.setDrawingTool("polygon");
      anno.setDrawingEnabled(true);
    } else {
      anno.setDrawingEnabled(false);
    }
  }, [tool, ready]);

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

  const drawing = tool === "bbox" || tool === "polygon";
  const cursor = drawing ? "crosshair" : "default";
  // overlay 永远放行指针：绘制交互由 OSD 容器内的 Annotorious 层承接，overlay 只读展示
  const density = metrics?.nuclei_density_mm2?.value;
  const area = metrics?.roi_area_mm2?.value;

  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", cursor }} />
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", touchAction: "none" }}
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
        <div style={{ ..._hint, color: "#4FB0FF" }}>⟳ 核检测中…（ROI 抽块 + StarDist 推理）</div>
      ) : (
        !pointSet && (
          <div style={_hint}>
            {tool === "bbox"
              ? "在切片上拖一个框，松开即保存（自动触发核检测）"
              : "工具栏选「▭ 框选」或「⬠ 多边形」，在切片上绘制标注"}
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
