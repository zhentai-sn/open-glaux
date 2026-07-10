import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Enums, RenderingEngine, csReady, type Types } from "../viewer/cornerstone";
import { niftiReady, preloadNiftiDims } from "../viewer/nifti";
import { api } from "../api/client";
import { useSession } from "../store/session";
import type { Measure, Primitive } from "../api/types";

// VolumeViewer（P6 楔子）——CS3D StackViewport 当 OrthographicViewport 用 + NIfTI 加载 +
// 滚轮切 z + labelmap 图例。CS3D 3.33.5 无 IOrthographicViewport（5.x 才有），用 StackViewport
// 视 NIfTI 为 z-stack 是常规做法（cornerstone3D 官方 NIfTI 演示也走此路）。
//
// 关键差异 vs raster_2d：wheel 切 z（不是 zoom）；labelmap 体素叠色 CS3D 5.x SegmentIndex
// 在 3.33.5 不稳定，v0 简化为图例 + 状态条；U4 画笔时再加 SegmentIndex。

const VP_ID = "glaux-stack-vol";
const RE_ID = "glaux-re-vol";

export function VolumeViewer() {
  const elRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const vpRef = useRef<Types.IStackViewport | null>(null);
  const imageIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [numSlices, setNumSlices] = useState(0);
  const [z, setZ] = useState(0);

  const activeVolume = useSession((s) => s.activeVolume);
  const primitives = useSession((s) => s.primitives);
  const metrics = useSession((s) => s.metrics);
  const tool = useSession((s) => s.tool);
  const tasks = useSession((s) => s.tasks);
  const modality = useSession((s) => s.modality);

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const overlays = useMemo(() => {
    const ps: Primitive[] = primitives;
    const vol = ps.find((p): p is Extract<Primitive, { kind: "volume_mask" }> => p.kind === "volume_mask");
    return vol ? vol.classes : null;
  }, [primitives]);

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
    if (!ov) return;
    sizeOverlay();
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!overlays) return;
    const legendX = 12;
    let legendY = ov.height - 12 - overlays.length * 18;
    ctx.font = "11px ui-monospace,monospace";
    ctx.textAlign = "left";
    for (const c of overlays) {
      ctx.fillStyle = c.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(legendX, legendY, 12, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.fillText(`${c.label.zh} (class_id=${c.class_id})`, legendX + 18, legendY + 10);
      legendY += 18;
    }
    if (numSlices > 0) {
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.font = "bold 12px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(`z ${z + 1} / ${numSlices}`, ov.width - 12, 20);
    }
  }, [overlays, z, numSlices, sizeOverlay]);

  // 一次性 init CS3D + nifti loader + StackViewport
  useEffect(() => {
    let disposed = false;
    (async () => {
      await csReady();
      await niftiReady();
      if (disposed || !elRef.current) return;
      const engine = new RenderingEngine(RE_ID);
      engine.enableElement({
        viewportId: VP_ID,
        type: Enums.ViewportType.STACK,
        element: elRef.current,
      });
      engineRef.current = engine;
      vpRef.current = engine.getViewport(VP_ID) as Types.IStackViewport;
      setReady(true);
    })();
    return () => {
      disposed = true;
      try {
        engineRef.current?.destroy();
      } catch {
        /* noop */
      }
      engineRef.current = null;
      vpRef.current = null;
    };
  }, []);

  // 切 volume → 重设 imageId + 设 numSlices
  useEffect(() => {
    if (!ready || !activeVolume) return;
    const vp = vpRef.current;
    if (!vp) return;
    const imageId = `nifti:${api.volumeUrl(activeVolume)}`;
    imageIdRef.current = imageId;
    let cancelled = false;
    (async () => {
      const dim = await preloadNiftiDims(imageId);
      if (cancelled) return;
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      await vp.setStack([imageId]);
      vp.resetCamera();
      vp.render();
      setNumSlices(dim.slices);
      setZ(Math.floor(dim.slices / 2));
    })();
    return () => { cancelled = true; };
  }, [ready, activeVolume]);

  // z 变化 → 切 StackViewport 的 imageIdIndex
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || numSlices <= 0) return;
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

  // primitive 变化 → 重绘图例
  useEffect(() => {
    drawOverlay();
  }, [primitives, overlays, drawOverlay]);

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

  const cursor = tool === "cursor" ? "grab" : "crosshair";

  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} />
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor, touchAction: "none" }}
        onWheel={onWheel}
      />
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          background: "rgba(20,20,20,0.65)",
          color: "rgba(230,234,240,0.95)",
          padding: "6px 10px",
          borderRadius: 6,
          font: "12px ui-monospace,monospace",
          pointerEvents: "none",
        }}
      >
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
    </div>
  );
}

function fmtVol(mm3: number): string {
  if (Math.abs(mm3) >= 1000) return `${(mm3 / 1000).toFixed(1)} cm³`;
  return `${mm3.toFixed(1)} mm³`;
}
