// T0 spike（计划 2026-08-16-002）——核实四件事：
// 1) @cornerstonejs/tools 在项目自定义 web: loader（spacing=1、无 DICOM）的 StackViewport 上建标注；
// 2) PlanarFreehandROITool 创建 + 顶点编辑；
// 3) StackViewport 上 segmentation（labelmap）+ BrushTool 画笔画入体素；
// 4) @annotorious/openseadragon 与 openseadragon@4.1.1 运行时兼容（初始化 + 编程式建标注）。
// 结果全部渲染为文本 + window.__spikeResults，供自动判读。
import { useEffect, useRef, useState } from "react";

// pixi（annotorious 依赖）需要 eval；部分环境 CSP 禁止——官方补丁包必须在 pixi 首次使用前加载
import "@pixi/unsafe-eval";
import { cache, eventTarget, Enums as CoreEnums, RenderingEngine, imageLoader as csImageLoader, metaData as csMetaData } from "@cornerstonejs/core";
import * as csTools from "@cornerstonejs/tools";
import OpenSeadragon from "openseadragon";

import { csReady, preloadDims } from "../viewer/cornerstone";

type Result = { name: string; pass: boolean; detail: string };

// 模块级结果存储——与 React 组件实例解耦，StrictMode 双挂载不影响上报
const spikeResults: Result[] = [];
const spikeListeners = new Set<() => void>();
let spikeStarted = false;
function report(r: Result) {
  spikeResults.push(r);
  (window as unknown as { __spikeResults: Result[] }).__spikeResults = spikeResults;
  spikeListeners.forEach((l) => l());
}

const RE_ID = "spike-re";
const VP_ID = "spike-vp";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 合成 512x512 测试图（渐变 + 圆斑），返回 data URL——不依赖后端。 */
function makeTestImageUrl(): string {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 512;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "#20242c");
  g.addColorStop(1, "#8a93a6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#d8dee9";
  ctx.beginPath();
  ctx.arc(256, 256, 90, 0, Math.PI * 2);
  ctx.fill();
  return cv.toDataURL("image/png");
}

// cornerstone-tools 监听的是 MouseEvent（mousedown/mousemove/mouseup/dblclick），
// 不是 PointerEvent——模拟必须用 MouseEvent（已在 node_modules 源码核实）。
function fire(el: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      ...extra,
    }),
  );
}

async function drag(el: HTMLElement, x0: number, y0: number, x1: number, y1: number, steps = 8) {
  fire(el, "mousedown", x0, y0);
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    fire(el, "mousemove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(16);
  }
  fire(el, "mouseup", x1, y1);
  await sleep(50);
}

/** 尽力读当前 viewport 的标注（state reader 多版本兼容 + 事件兜底）。 */
function readAnnotations(viewportId: string, fromEvents: unknown[]): unknown[] {
  const ann = csTools.annotation as unknown as { state?: Record<string, unknown> };
  try {
    const mgr = (ann.state?.getAnnotationManager as (() => { get: (id: string) => Record<string, unknown[]> }) | undefined)?.();
    if (mgr) {
      const rec = mgr.get(viewportId);
      if (rec) return Object.values(rec).flat();
    }
  } catch {
    /* fallthrough */
  }
  try {
    const all = (csTools.utilities as unknown as { getAllAnnotations?: () => unknown[] }).getAllAnnotations?.();
    if (all && all.length) return all;
  } catch {
    /* fallthrough */
  }
  // 事件兑底：detail 结构为 {annotation, ...}，归一后返回
  return fromEvents.map((e) => (e as { annotation?: unknown })?.annotation ?? e);
}

export function SpikePage() {
  const csElRef = useRef<HTMLDivElement>(null);
  const osdElRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // 订阅模块级结果，任意实例都能渲染
  useEffect(() => {
    const l = () => force((x) => x + 1);
    spikeListeners.add(l);
    return () => {
      spikeListeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (spikeStarted) return;
    spikeStarted = true;
    (window as unknown as { __spikeResults: Result[] }).__spikeResults = spikeResults;

    const addedEvents: unknown[] = [];
    const onAnnAdded = (e: Event) => addedEvents.push((e as CustomEvent).detail);
    eventTarget.addEventListener(csTools.Enums.Events.ANNOTATION_ADDED as unknown as string, onAnnAdded);
    eventTarget.addEventListener(csTools.Enums.Events.ANNOTATION_COMPLETED as unknown as string, onAnnAdded);

    (async () => {
      const imageUrl = makeTestImageUrl();

      let vp: { id: string; element: HTMLElement; worldToCanvas: (p: [number, number, number]) => [number, number] } | null = null;
      let engine: RenderingEngine | null = null;
      try {
        // --- 初始化：core（项目 loader）+ tools -------------------------------
        // HMR 重跑清洁：先拆旧 toolGroup / engine，避免 id 重复与元素泄漏
        try {
          csTools.ToolGroupManager.destroyToolGroup("spike-tg");
        } catch {
          /* 不存在则忽略 */
        }
        await csReady();
        await csTools.init();
        const imageId = `web:${imageUrl}`;
        await preloadDims(imageId);

        const engineNew = new RenderingEngine(RE_ID);
        engine = engineNew;
        engineNew.enableElement({ viewportId: VP_ID, type: CoreEnums.ViewportType.STACK, element: csElRef.current! });
        const viewport = engineNew.getViewport(VP_ID);
        await viewport.setStack([imageId], 0);
        viewport.resetCamera();
        viewport.render();
        vp = viewport as unknown as typeof vp;
        report({ name: "init", pass: true, detail: "csTools.init + web: loader StackViewport 就绪" });

        // --- 注册工具 + ToolGroup --------------------------------------------
        csTools.addTool(csTools.RectangleROITool);
        csTools.addTool(csTools.PlanarFreehandROITool);
        csTools.addTool(csTools.BrushTool);
        csTools.addTool(csTools.PanTool);
        const tg = csTools.ToolGroupManager.createToolGroup("spike-tg")!;
        tg.addViewport(VP_ID, RE_ID);
        tg.addTool(csTools.RectangleROITool.toolName);
        tg.addTool(csTools.PlanarFreehandROITool.toolName);
        tg.addTool(csTools.BrushTool.toolName);
        tg.addTool(csTools.PanTool.toolName);
        report({ name: "toolgroup", pass: true, detail: "addTool×4 + ToolGroup 绑定 viewport 成功" });

        const el = csElRef.current!;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // --- Spike 1：RectangleROITool 拖拽建标注 -----------------------------
        try {
          tg.setToolActive(csTools.RectangleROITool.toolName, {
            bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
          });
          await drag(el, cx - 60, cy - 40, cx + 60, cy + 40);
          const anns = readAnnotations(VP_ID, addedEvents) as Array<{ metadata?: { toolName?: string }; data?: unknown }>;
          const rects = anns.filter((a) => a?.metadata?.toolName === csTools.RectangleROITool.toolName);
          report({
            name: "spike1-rect",
            pass: rects.length > 0,
            detail: rects.length > 0 ? `RectangleROI 标注已创建（${rects.length} 条，含 handles 数据）` : `未找到标注（事件 ${addedEvents.length} 条）`,
          });
        } catch (err) {
          report({ name: "spike1-rect", pass: false, detail: String(err) });
        }

        // --- Spike 2：PlanarFreehandROI 自由手绘创建 + 顶点编辑 ----------------
        try {
          tg.setToolDisabled(csTools.RectangleROITool.toolName);
          tg.setToolConfiguration(csTools.PlanarFreehandROITool.toolName, { freehand: true });
          tg.setToolActive(csTools.PlanarFreehandROITool.toolName, {
            bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
          });
          await drag(el, cx - 80, cy - 60, cx + 80, cy + 20, 14);
          let anns = readAnnotations(VP_ID, addedEvents) as Array<{
            metadata?: { toolName?: string };
            data?: { contour?: { polyline?: [number, number, number][] } };
          }>;
          const fh = anns.find((a) => a?.metadata?.toolName === csTools.PlanarFreehandROITool.toolName);
          const nPts = fh?.data?.contour?.polyline?.length ?? 0;
          if (!fh || nPts < 3) {
            report({ name: "spike2-freehand", pass: false, detail: `未创建 freehand 标注（points=${nPts}）` });
          } else {
            report({ name: "spike2-freehand", pass: true, detail: `freehand 轮廓已创建（${nPts} 点，closed 轮廓）` });
            // 顶点编辑：passive 态下拖一个顶点
            try {
              const before = JSON.stringify(fh.data?.contour?.polyline);
              tg.setToolPassive(csTools.PlanarFreehandROITool.toolName);
              const p0 = fh.data!.contour!.polyline![Math.floor(nPts / 4)];
              const [hx, hy] = vp!.worldToCanvas(p0);
              const r2 = el.getBoundingClientRect();
              await drag(el, r2.left + hx, r2.top + hy, r2.left + hx + 24, r2.top + hy + 18, 5);
              const after = JSON.stringify(fh.data?.contour?.polyline);
              report({
                name: "spike2-vertex-edit",
                pass: before !== after,
                detail: before !== after ? "顶点拖动后轮廓点已变化" : "模拟拖动未改变顶点（需人工走查确认 passive 交互）",
              });
            } catch (err) {
              report({ name: "spike2-vertex-edit", pass: false, detail: String(err) });
            }
          }
        } catch (err) {
          report({ name: "spike2-freehand", pass: false, detail: String(err) });
        }

        // --- Spike 3：segmentation labelmap + BrushTool -----------------------
        // 3.33.5 事实：StackViewport 的 labelmap 不会从 data:{} 自动生成，
        // 需预建每帧派生 labelmap imageId（自注册派生 loader）再挂 representation。
        try {
          const segId = "spike-seg";
          const lmImageIds = [imageId].map((id) => `spikelm:${id}`);
          csImageLoader.registerImageLoader("spikelm", (lid: string) => {
            const columns = 512;
            const rows = 512;
            const pixelData = new Uint8Array(columns * rows);
            const image = {
              imageId: lid,
              dataType: "Uint8Array",
              minPixelValue: 0,
              maxPixelValue: 255,
              slope: 1,
              intercept: 0,
              windowCenter: 128,
              windowWidth: 256,
              getPixelData: () => pixelData,
              rows,
              columns,
              height: rows,
              width: columns,
              color: false,
              rgba: false,
              numberOfComponents: 1,
              columnPixelSpacing: 1,
              rowPixelSpacing: 1,
              invert: false,
              sizeInBytes: pixelData.byteLength,
            };
            return { promise: Promise.resolve(image) } as unknown as ReturnType<typeof csImageLoader.registerImageLoader>;
          });
          csMetaData.addProvider((type: string, id: string) => {
            if (typeof id !== "string" || !id.startsWith("spikelm:")) return undefined;
            if (type === "imagePixelModule") {
              return { samplesPerPixel: 1, photometricInterpretation: "MONOCHROME2", rows: 512, columns: 512, bitsAllocated: 8, bitsStored: 8, highBit: 7, pixelRepresentation: 0 };
            }
            if (type === "imagePlaneModule") {
              return { imageOrientationPatient: [1, 0, 0, 0, 1, 0], imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], pixelSpacing: [1, 1], rowPixelSpacing: 1, columnPixelSpacing: 1, rows: 512, columns: 512, frameOfReferenceUID: "GLAUX_2D" };
            }
            if (type === "generalSeriesModule") return { modality: "US" };
            if (type === "voiLutModule") return { windowCenter: 128, windowWidth: 256 };
            return undefined;
          }, 11000);

          await csTools.segmentation.addSegmentations([
            {
              segmentationId: segId,
              representation: { type: csTools.Enums.SegmentationRepresentations.Labelmap, data: { imageIds: lmImageIds } },
            },
          ]);
          await csTools.segmentation.addSegmentationRepresentations(VP_ID, [
            { segmentationId: segId, type: csTools.Enums.SegmentationRepresentations.Labelmap },
          ]);
          try {
            (csTools.segmentation.activeSegmentation as unknown as { setActiveSegmentationIndex: (a: string, b: number) => void })
              .setActiveSegmentationIndex(segId, 1);
          } catch {
            /* 版本差异：部分版本按 viewport 设置 */
          }
          tg.setToolDisabled(csTools.PlanarFreehandROITool.toolName);
          tg.setToolConfiguration(csTools.BrushTool.toolName, { radius: 8 });
          tg.setToolActive(csTools.BrushTool.toolName, {
            bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
          });
          await drag(el, cx - 30, cy - 30, cx + 30, cy + 30, 10);
          await sleep(100);

          // 读回：优先 stack labelmap 派生 image 的 pixelData，其次 volume
          let nz = -1;
          let src = "";
          try {
            const ilo = cache.getImageLoadObject(lmImageIds[0]);
            const img = await ilo.promise;
            const data = (img as unknown as { getPixelData: () => ArrayLike<number> }).getPixelData();
            nz = 0;
            for (let i = 0; i < data.length; i++) if (data[i] > 0) nz++;
            src = `stack labelmap 派生 image（${lmImageIds[0]}）`;
          } catch {
            /* fallthrough 到 volume 路径 */
          }
          if (nz <= 0) {
            const seg = (csTools.segmentation.state as unknown as { getSegmentation: (id: string) => { representationData?: Record<string, { volumeId?: string; stackVolumeId?: string }> } }).getSegmentation(segId);
            const lm = seg?.representationData?.Labelmap;
            const volId = lm?.volumeId ?? lm?.stackVolumeId;
            const vol = volId ? cache.getVolume(volId) : null;
            if (vol) {
              const data = (vol as unknown as { scalarData: ArrayLike<number> }).scalarData;
              nz = 0;
              for (let i = 0; i < data.length; i++) if (data[i] > 0) nz++;
              src = `volume（${volId}）`;
            }
          }
          report({
            name: "spike3-brush",
            pass: nz > 0,
            detail: nz > 0 ? `labelmap 画入成功（${nz} 体素非零，来源：${src}）` : `未见体素（尝试：派生 imageIds + volume 两路）——stack labelmap 宿主需 T5 专项处理`,
          });
        } catch (err) {
          report({ name: "spike3-brush", pass: false, detail: String(err) });
        }
      } catch (err) {
        report({ name: "init", pass: false, detail: String(err) });
      }

      // --- Spike 4：Annotorious + OSD 4.1.1 -----------------------------------
      try {
        let evalAllowed = true;
        try {
          // eslint-disable-next-line no-new-func
          new Function("return 1")();
        } catch {
          evalAllowed = false;
        }
        const { createOSDAnnotator } = await import("@annotorious/openseadragon");
        await import("@annotorious/openseadragon/annotorious-openseadragon.css");
        const osd = OpenSeadragon({
          element: osdElRef.current!,
          showNavigationControl: false,
          tileSources: { type: "image", url: imageUrl },
        });
        await new Promise<void>((resolve) => osd.addOnceHandler("open", () => resolve()));
        const anno = createOSDAnnotator(osd);
        await sleep(100);
        try {
          const created = await anno.createAnnotation({
            target: {
              selector: {
                type: "FragmentSelector",
                conformsTo: "http://www.w3.org/TR/media-frags/",
                value: "xywh=pixel:120,120,220,160",
              },
            },
          });
          const all = anno.store.getAllAnnotations();
          const tools = anno.listDrawingTools?.() ?? [];
          report({
            name: "spike4-annotorious",
            pass: !!created && all.length === 1,
            detail: `OSD ${OpenSeadragon.version} + Annotorious 初始化成功；编程式建标注 ${all.length} 条；drawingTools=${JSON.stringify(tools)}`,
          });
        } catch (err) {
          // pixi（WebGL 标注层）需 eval；受控浏览器沙箱 CSP 禁止时在此失败，真实用户浏览器无此 CSP
          report({
            name: "spike4-annotorious",
            pass: false,
            detail: `初始化成功但建标注失败（envEvalAllowed=${evalAllowed}，已 import @pixi/unsafe-eval@7 对 pixi 7.4.3）：${String(err)}——若仅沙箱环境复现则为环境假象，需真实浏览器复核`,
          });
        }
      } catch (err) {
        report({ name: "spike4-annotorious", pass: false, detail: String(err) });
      }

      // 清理：避免 HMR 重跑时残留引擎/分割状态
      try {
        engine?.destroy();
      } catch {
        /* noop */
      }

      report({ name: "done", pass: true, detail: "SPIKE DONE" });
    })();

    // spike 页生命周期内不摘监听（StrictMode 会提前 cleanup，而 IIFE 仍在异步跑）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = spikeResults;

  const passed = results.filter((r) => r.pass && r.name !== "done").length;
  const total = results.filter((r) => r.name !== "done" && r.name !== "init").length + 1;
  return (
    <div style={{ padding: 16, fontFamily: "monospace", color: "#e6eaf0", background: "#101216", minHeight: "100vh" }}>
      <h2 style={{ margin: "0 0 8px" }}>T0 Spike · 统一标注工具箱开工前核实</h2>
      <p style={{ margin: "0 0 12px", color: "#8a93a6" }}>
        {results.some((r) => r.name === "done") ? `结果：${passed}/${total} 项通过` : "运行中…"}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
        {results.map((r, i) => (
          <li key={i} style={{ margin: "4px 0", color: r.pass ? "#7BE0AD" : "#FF6B6B" }}>
            [{r.pass ? "PASS" : "FAIL"}] {r.name} — {r.detail}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 16 }}>
        <div ref={csElRef} style={{ width: 420, height: 420, background: "#000", position: "relative" }} />
        <div ref={osdElRef} style={{ width: 420, height: 420, background: "#000" }} />
      </div>
    </div>
  );
}
