import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { csUtils, type Types } from "./cornerstone";
import { activateTool } from "./csTools";
import { ImtWallHandleTool } from "./imtWallTool";
import { drawPrimitives } from "./overlay/painters";
import { useBrushBuffer } from "./hooks/useBrushBuffer";
import { useCsStackEngine } from "./hooks/useCsStackEngine";
import { useOverlayCanvas } from "./hooks/useOverlayCanvas";
import { loadNiftiVolume, invalidateNiftiVolume } from "./nifti";
import { IDENTITY_PIXEL_MAP, pixelMapFor } from "./pixelMap";
import { api } from "../api/client";
import { loadAnnotations } from "../annotation/bridge";
import { resetCsAnnoBridge, syncCsAnnotations } from "../annotation/csAnno";
import { annotation, ToolGroupManager, utilities as csToolsUtils } from "@cornerstonejs/tools";
import type { ClassSpec, Primitive, TaskOverlaySpec } from "../api/types";
import { mmPerPx } from "../data/objectInfo";
import type { ViewerProps } from "./contract";

// image / volume 共用的 CS3D StackViewport 引擎（SDD 10 W4）。
// 交互全部走统一框架：相机（Pan/Zoom）与自由标注（bbox/polygon 绘制+顶点编辑）由
// @cornerstonejs/tools 承担；IMT 壁线形变是自定义 BaseTool（ImtWallHandleTool，D-12），
// 提交仍走 /task/measure（D-14：任务绑定几何，口径不变）。
// 本组件 overlay 只画框架渲染不了的：壁线/椭圆（Detection）、比例尺、mask 叠色与画笔笔迹。
// 2D brush 宿主退化方案（T0 spike3）：CS3D segmentation 在 stack 上未打通 → 自持 mask 缓冲，
// 提交走 /annotations（kind=mask），reload 经 /annotations/{id}/mask 叠色。

const EMPTY_OVERLAYS: TaskOverlaySpec[] = [];
const SNAP_MM = [1, 2, 5, 10, 20, 50, 100];
const MASK_ALPHA = 0.5;
const VOLUME_ALPHA = 0.4;
type VolPrim = Extract<Primitive, { kind: "volume_mask" }>;
type LabelVol = { columns: number; rows: number; slices: number; raw: Int32Array };

function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const parsed = parseInt(value.length === 3 ? value.split("").map((part) => part + part).join("") : value, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

export function FrameStackViewer({ object, focus, source, task: taskView, capabilities, primitives, annotations, tool, toolOptions, maskSink, axis, voi, painters, onCoords }: ViewerProps) {
  const isVolume = object.kind === "volume";
  const RE_ID = isVolume ? "glaux-re-vol" : "glaux-re";
  const VP_ID = isVolume ? "glaux-stack-vol" : "glaux-stack";
  const TG_ID = isVolume ? "glaux-tg-vol" : "glaux-tg-raster2d";
  const imageIdRef = useRef<string | null>(null);
  const stackIdsRef = useRef<string[]>([]);
  const preferredZRef = useRef<{ objectId: string; z: number } | null>(null);
  const pixelMapRef = useRef(IDENTITY_PIXEL_MAP);
  const { elementRef: elRef, engineRef, viewportRef: vpRef, ready } = useCsStackEngine({
    renderingEngineId: RE_ID,
    viewportId: VP_ID,
    toolGroupId: TG_ID,
    nifti: isVolume,
    getImageId: () => imageIdRef.current,
    pixelMap: () => pixelMapRef.current,
    toTarget: () => ({ image_id: object.id, ...(isVolume ? { z: focus.index.z ?? null } : {}) }),
  });
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<Primitive[]>([]);
  const { buffer: brushBuf, clear: clearBrush, paint: paintBrush } = useBrushBuffer();
  const brushDims = useRef<{ columns: number; rows: number } | null>(null);
  const brushing = useRef(false);
  const maskImgs = useRef(new Map<string, HTMLCanvasElement>()); // 已保存 mask 的着色画布缓存
  const labelVolRef = useRef<LabelVol | null>(null);
  const [numSlices, setNumSlices] = useState(0);
  const [busy, setBusy] = useState(false);

  const objectId = object.id;
  const cf = mmPerPx(object);
  const axisRef = useRef(axis);
  axisRef.current = axis;
  const setIndex = useCallback((index: number) => {
    const current = axisRef.current;
    if (current.kind === "z") current.onIndex(index);
  }, []);
  const overlays = taskView?.overlays ?? EMPTY_OVERLAYS;
  const volPrim = useMemo<VolPrim | null>(() => primitives.find((p): p is VolPrim => p.kind === "volume_mask") ?? null, [primitives]);
  const classes = volPrim?.classes ?? null;
  const classById = useMemo(() => new Map<number, ClassSpec>((classes ?? []).map((item) => [item.class_id, item])), [classes]);
  const z = focus.index.z ?? 0;
  const wallEditing = tool === "wall"; // 手柄只在壁线编辑态画（能力位由注册表限定为 IMT）

  // 像素坐标 → overlay 画布坐标（CSS px，与 worldToCanvas / pointer 同一空间）
  const projRef = useRef<(x: number, y: number) => [number, number]>(() => [0, 0]);

  // --- store.tool → ToolGroup 激活态（2D brush 走自持缓冲，不激活 CS3D BrushTool）
  useEffect(() => {
    if (!ready) return;
    const tg = ToolGroupManager.getToolGroup(TG_ID);
    if (!tg) return;
    // brush 在 raster_2d 是 overlay 自持缓冲（spike3 退化方案）→ 激活态回退 pan
    activateTool(tg, tool === "brush" ? "cursor" : tool, capabilities, toolOptions, { wheelZoom: !isVolume });
  }, [ready, tool, toolOptions, capabilities, isVolume, TG_ID]);

  const sizeOverlay = useCallback(() => {
    const el = elRef.current;
    const ov = overlayRef.current;
    if (!el || !ov) return;
    const r = el.getBoundingClientRect();
    if (ov.width !== Math.round(r.width) || ov.height !== Math.round(r.height)) {
      ov.width = Math.round(r.width);
      ov.height = Math.round(r.height);
    }
  }, []);

  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const vp = vpRef.current;
    const imageId = imageIdRef.current;
    if (!ov || !vp || !imageId) return;
    sizeOverlay();
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);

    if (isVolume) {
      const lv = labelVolRef.current;
      if (lv && vp && z < lv.slices) {
        const { columns, rows } = lv;
        const sliceLen = columns * rows;
        const slice = lv.raw.subarray(z * sliceLen, (z + 1) * sliceLen);
        const off = document.createElement("canvas");
        off.width = columns;
        off.height = rows;
        const octx = off.getContext("2d")!;
        const image = octx.createImageData(columns, rows);
        const edit = brushBuf.current;
        for (let i = 0; i < sliceLen; i++) {
          const cid = slice[i];
          let rgb: [number, number, number] | null = null;
          if (cid > 0) {
            const cls = classById.get(cid);
            rgb = cls ? hexToRgb(cls.color) : [255, 80, 80];
          }
          if (edit && edit[i]) rgb = toolOptions.brush.mode === "erase" ? [255, 60, 60] : hexToRgb(classById.get(toolOptions.brush.classId)?.color ?? "#ffffff");
          const offset = i * 4;
          if (rgb) {
            image.data[offset] = rgb[0];
            image.data[offset + 1] = rgb[1];
            image.data[offset + 2] = rgb[2];
            image.data[offset + 3] = 255;
          }
        }
        octx.putImageData(image, 0, 0);
        const tl = vp.worldToCanvas([0, 0, 0] as Types.Point3);
        const br = vp.worldToCanvas([columns, rows, 0] as Types.Point3);
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = VOLUME_ALPHA;
        ctx.drawImage(off, 0, 0, columns, rows, tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
        ctx.globalAlpha = 1;
      }
      if (classes) {
        let legendY = ov.height - 12 - classes.length * 18;
        ctx.font = "11px ui-monospace,monospace";
        ctx.textAlign = "left";
        for (const cls of classes) {
          ctx.fillStyle = cls.color;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(12, legendY, 12, 12);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(230,234,240,0.95)";
          ctx.fillText(`${cls.label.zh} (class_id=${cls.class_id})`, 30, legendY + 10);
          legendY += 18;
        }
      }
      if (numSlices > 0) {
        ctx.fillStyle = "rgba(230,234,240,0.95)";
        ctx.font = "bold 12px ui-monospace,monospace";
        ctx.textAlign = "right";
        ctx.fillText(`z ${z + 1} / ${numSlices}`, ov.width - 12, 20);
      }
      if (busy) {
        ctx.fillStyle = "rgba(79,176,255,0.95)";
        ctx.font = "11px ui-monospace,monospace";
        ctx.textAlign = "right";
        ctx.fillText("…", ov.width - 12, 36);
      }
      return;
    }

    const proj = (x: number, y: number): [number, number] => {
      const world = csUtils.imageToWorldCoords(imageId, pixelMapRef.current.toFrame(x, y) as Types.Point2) as Types.Point3;
      const [cx, cy] = vp.worldToCanvas(world);
      return [cx, cy];
    };
    projRef.current = proj;

    drawPrimitives(ctx, work.current, proj, { overlays, index: focus.index, wallEditing }, painters);

    // 已保存 mask 标注叠色（bbox/polygon 由 CS3D 标注层自渲染，此处只管 mask）
    const bd = brushDims.current;
    if (bd) {
      ctx.imageSmoothingEnabled = false;
      const [tlx, tly] = proj(0, 0);
      const [brx, bry] = proj(bd.columns, bd.rows);
      for (const a of annotations) {
        if (a.primitive.kind !== "mask" || a.id.startsWith("tmp-")) continue;
        const cv = maskImgs.current.get(a.id);
        if (cv) {
          ctx.globalAlpha = MASK_ALPHA;
          ctx.drawImage(cv, tlx, tly, brx - tlx, bry - tly);
          ctx.globalAlpha = 1;
        }
      }
      // 未提交笔迹预览
      const buf = brushBuf.current;
      if (buf) {
        const off = document.createElement("canvas");
        off.width = bd.columns;
        off.height = bd.rows;
        const octx = off.getContext("2d")!;
        const img = octx.createImageData(bd.columns, bd.rows);
        for (let i = 0; i < buf.length; i++) {
          if (!buf[i]) continue;
          const o = i * 4;
          img.data[o] = 79;
          img.data[o + 1] = 176;
          img.data[o + 2] = 255;
          img.data[o + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        ctx.globalAlpha = MASK_ALPHA;
        ctx.drawImage(off, tlx, tly, brx - tlx, bry - tly);
        ctx.globalAlpha = 1;
      }
    }

    // 比例尺——按 CF 自适应取整刻度，以像素长度经投影量得屏幕长度
    if (cf && cf > 0 && imageIdRef.current) {
      const targetMm = 40;
      const barMm = SNAP_MM.reduce((best, m) => (Math.abs(m - targetMm) < Math.abs(best - targetMm) ? m : best), SNAP_MM[0]);
      const barPx = barMm / cf;
      const [ax] = proj(0, 0);
      const [bx] = proj(barPx, 0);
      const scr = Math.abs(bx - ax);
      const sx = ov.width - scr - 16;
      const sy = ov.height - 16;
      ctx.strokeStyle = "rgba(230,234,240,.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + scr, sy);
      ctx.moveTo(sx, sy - 4);
      ctx.lineTo(sx, sy + 4);
      ctx.moveTo(sx + scr, sy - 4);
      ctx.lineTo(sx + scr, sy + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(230,234,240,.9)";
      ctx.font = "10px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${barMm} mm`, sx + scr / 2, sy - 6);
    }
  }, [cf, wallEditing, overlays, focus.index, sizeOverlay, isVolume, z, classById, toolOptions.brush.mode, toolOptions.brush.classId, classes, numSlices, busy, annotations, painters]);

  // drawOverlay 每次重渲染都会换标识（依赖 cf/overlays/工具态）——载图与标注回灌副作用
  // 不能把它放进依赖数组：那会让「切图」副作用在无关重渲染时重跑，其开头的
  // removeAllAnnotations() 会把已画/已回灌的标注整层清掉（画完的框凭空消失即源于此）。
  const drawOverlayRef = useRef(drawOverlay);
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  // 载图：预取尺寸 → setStack → reset 相机 → 拉标注（bbox/polygon/mask 统一面）
  useEffect(() => {
    if (!ready || !objectId) return;
    const vp = vpRef.current;
    if (!vp) return;
    // 切图清旧：CS3D 标注层 + 桥映射 + 画笔缓冲 + mask 缓存
    // （同一时刻仅一个查看器挂载，removeAllAnnotations 不会误伤其他引擎）
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* 无标注时静默 */
    }
    resetCsAnnoBridge();
    clearBrush();
    imageIdRef.current = null;
    stackIdsRef.current = [];
    brushDims.current = null;
    maskImgs.current.clear();
    if (isVolume) {
      setNumSlices(0);
      labelVolRef.current = null;
      const preferred = preferredZRef.current?.objectId === objectId ? preferredZRef.current.z : null;
      setIndex(preferred ?? 0);
    }
    let cancelled = false;
    (async () => {
      const ids = await source.imageIds();
      const dim = await source.dims();
      if (cancelled) return;
      if (isVolume) {
        const mid = Math.floor(dim.frames / 2);
        stackIdsRef.current = ids;
        for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        if (cancelled) return;
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
        setIndex(latestPreferred ?? initialZ);
        return;
      }
      const imageId = ids[0];
      imageIdRef.current = imageId;
      pixelMapRef.current = pixelMapFor(object, dim);
      ToolGroupManager.getToolGroup(TG_ID)?.setToolConfiguration(ImtWallHandleTool.toolName, { objectId, imageId, pixelMap: pixelMapRef.current });
      brushDims.current = pixelMapRef.current.objectDims;
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      await vp.setStack([imageId]);
      if (cancelled) return;
      vp.resetCamera();
      vp.render();
      drawOverlayRef.current();
      void loadAnnotations(objectId);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, objectId, object, source, clearBrush, isVolume, setIndex, TG_ID]);

  const labelRef = isVolume ? volPrim?.ref ?? null : null;
  useEffect(() => {
    if (!labelRef) {
      labelVolRef.current = null;
      if (isVolume) drawOverlayRef.current();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const volume = await loadNiftiVolume(labelRef);
        if (cancelled) return;
        labelVolRef.current = { columns: volume.columns, rows: volume.rows, slices: volume.slices, raw: volume.raw };
        const sliceLen = volume.columns * volume.rows;
        let bestZ = -1;
        let bestCount = 0;
        for (let zz = 0; zz < volume.slices; zz++) {
          let count = 0;
          for (let i = 0; i < sliceLen; i++) if (volume.raw[zz * sliceLen + i] > 0) count++;
          if (count > bestCount) { bestCount = count; bestZ = zz; }
        }
        if (bestZ >= 0) {
          preferredZRef.current = { objectId, z: bestZ };
          setIndex(bestZ);
        }
      } catch {
        labelVolRef.current = null;
      }
      drawOverlayRef.current();
    })();
    return () => { cancelled = true; };
  }, [labelRef, objectId, setIndex, isVolume]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!isVolume || !vp || numSlices <= 0 || !objectId) return;
    clearBrush();
    imageIdRef.current = stackIdsRef.current[z] ?? null;
    try { annotation.state.removeAllAnnotations(); } catch { /* 无标注 */ }
    resetCsAnnoBridge();
    void loadAnnotations(objectId, z);
    (async () => {
      try {
        await vp.setImageIdIndex(z);
        vp.render();
      } catch { /* 切帧期间保持现状 */ }
      drawOverlayRef.current();
    })();
  }, [isVolume, z, numSlices, objectId, clearBrush]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!isVolume || !vp || numSlices <= 0) return;
    if (!voi) return;
    const { ww, wl } = voi;
    try {
      vp.setProperties({ voiRange: { lower: wl - ww / 2, upper: wl + ww / 2 } });
      vp.render();
    } catch { /* 切卷期间保持现状 */ }
  }, [isVolume, numSlices, objectId, voi]);

  // store.annotations → CS3D 标注层回灌（bbox/polygon；mask 走 overlay 叠色）+ mask 着色加载
  useEffect(() => {
    if (!ready || !imageIdRef.current) return;
    const vp = vpRef.current;
    const forId = (vp as unknown as { getFrameOfReferenceUID?: () => string })?.getFrameOfReferenceUID?.() ?? "GLAUX_2D";
    if (syncCsAnnotations(annotations, imageIdRef.current, forId, forId, pixelMapRef.current))
      csToolsUtils.triggerAnnotationRenderForViewportIds([VP_ID]);
    // mask 着色画布懒加载（加载完成触发重绘）
    if (isVolume) return;
    for (const a of annotations) {
      if (a.primitive.kind !== "mask" || a.id.startsWith("tmp-") || maskImgs.current.has(a.id)) continue;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const c = cv.getContext("2d")!;
        c.drawImage(img, 0, 0);
        const d = c.getImageData(0, 0, cv.width, cv.height);
        for (let i = 0; i < d.data.length; i += 4) {
          if (d.data[i] > 0 || d.data[i + 1] > 0 || d.data[i + 2] > 0) {
            d.data[i] = 123;
            d.data[i + 1] = 224;
            d.data[i + 2] = 173;
            d.data[i + 3] = 255;
          } else {
            d.data[i + 3] = 0;
          }
        }
        c.putImageData(d, 0, 0);
        maskImgs.current.set(a.id, cv);
        drawOverlayRef.current();
      };
      img.src = api.annotations.maskUrl(a.id);
    }
  }, [annotations, ready, isVolume, z, VP_ID]);

  // store.primitives 变化 → 同步工作副本 + 重绘（壁线拖拽中间态也走这里）
  useEffect(() => {
    work.current = clonePrims(primitives);
    drawOverlay();
  }, [primitives, drawOverlay]);

  useOverlayCanvas(ready, elRef, engineRef, vpRef, drawOverlay);

  // 坐标展示：CS3D 容器原生 mousemove → 图像 px（工具交互期间同样生效）
  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el) return;
    const onMove = (e: MouseEvent) => {
      const vp = vpRef.current;
      const imageId = imageIdRef.current;
      if (!vp || !imageId) return;
      const r = el.getBoundingClientRect();
      try {
        const world = vp.canvasToWorld([e.clientX - r.left, e.clientY - r.top] as Types.Point2);
        const [ix, iy] = csUtils.worldToImageCoords(imageId, world) as Types.Point2;
        const [ox, oy] = pixelMapRef.current.toObject(ix, iy);
        onCoords({ x: Math.round(ox), y: Math.round(oy) });
      } catch {
        /* 视口瞬态 */
      }
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [ready, onCoords]);

  // --- 2D brush 自持缓冲（spike3 退化方案）：overlay 拦指针画/擦，提交走 bridge ----
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const vp = vpRef.current;
      const ov = overlayRef.current;
      if (!vp || !ov) return;
      const r = ov.getBoundingClientRect();
      const world = vp.canvasToWorld([clientX - r.left, clientY - r.top] as Types.Point2);
      if (isVolume) {
        const lv = labelVolRef.current;
        if (!lv) return;
        paintBrush(Math.round(world[0]), Math.round(world[1]), lv, toolOptions.brush.radius, toolOptions.brush.mode);
        drawOverlay();
        return;
      }
      const bd = brushDims.current;
      const imageId = imageIdRef.current;
      if (!bd || !imageId) return;
      const [fx, fy] = csUtils.worldToImageCoords(imageId, world) as Types.Point2;
      const [ox, oy] = pixelMapRef.current.toObject(fx, fy);
      const col = Math.round(ox);
      const row = Math.round(oy);
      paintBrush(col, row, bd, toolOptions.brush.radius, toolOptions.brush.mode);
      drawOverlay();
    },
    [toolOptions.brush.radius, toolOptions.brush.mode, paintBrush, drawOverlay, isVolume],
  );

  const onBrushDown = (e: React.PointerEvent) => {
    if (tool !== "brush" || busy) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    brushing.current = true;
    paintAt(e.clientX, e.clientY);
  };
  const onBrushMove = (e: React.PointerEvent) => {
    if (brushing.current) paintAt(e.clientX, e.clientY);
  };
  const onBrushUp = async () => {
    if (!brushing.current) return;
    brushing.current = false;
    const buf = brushBuf.current;
    const dims = isVolume ? labelVolRef.current : brushDims.current;
    if (!buf || !dims || !objectId || !buf.some((v) => v)) return;
    if (isVolume) setBusy(true);
    try {
      if (isVolume) {
        await maskSink.commit(buf, dims, { z });
        if (volPrim?.ref) {
          invalidateNiftiVolume(volPrim.ref);
          const volume = await loadNiftiVolume(volPrim.ref);
          labelVolRef.current = { columns: volume.columns, rows: volume.rows, slices: volume.slices, raw: volume.raw };
        }
        clearBrush();
      } else {
        await maskSink.commit(buf, dims, {});
        clearBrush(); // 已落库，转由已保存 mask 通道渲染
      }
      drawOverlay();
    } catch {
      if (isVolume) {
        clearBrush();
        drawOverlay();
      }
      // 2D bridge 已提示并回滚乐观草稿；保留笔迹供用户重试。
    } finally {
      if (isVolume) setBusy(false);
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!isVolume || numSlices <= 0) return;
    const delta = event.deltaY > 0 ? 1 : -1;
    setIndex(Math.max(0, Math.min(numSlices - 1, z + delta)));
  };

  const brushActive = tool === "brush";
  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }} onWheel={onWheel}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} onContextMenu={(e) => e.preventDefault()} />
      {/* brush 态 overlay 拦指针（自持缓冲）；其余态放行给 CS3D 工具层 */}
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
        onPointerDown={onBrushDown}
        onPointerMove={onBrushMove}
        onPointerUp={onBrushUp}
        onPointerLeave={onBrushUp}
      />
    </div>
  );
}
