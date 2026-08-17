// T5 卡死排障探针：逐级装配 CornerstoneViewer 依赖栈，每级完成打印标记。
// 用法：#/probe，观察卡在哪一级（P0 DOM → P4 完成）。
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { Enums, RenderingEngine, csReady, preloadDims, type Types } from "../viewer/cornerstone";

export function ProbePage() {
  const elRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState("P0 mounted");
  const mark = (s: string) => {
    setStage(s);
    console.log("[probe]", s);
  };

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        mark("P1 csReady start");
        await csReady();
        if (stop) return;
        mark("P1 csReady done");

        mark("P2 csToolsReady start");
        const { csToolsReady } = await import("../viewer/csTools");
        await csToolsReady();
        if (stop) return;
        mark("P2 csToolsReady done");

        mark("P3 engine start");
        const engine = new RenderingEngine("probe-re");
        engine.enableElement({ viewportId: "probe-vp", type: Enums.ViewportType.STACK, element: elRef.current! });
        const vp = engine.getViewport("probe-vp") as Types.IStackViewport;
        if (stop) return;
        mark("P3 engine done");

        mark("P3b toolgroup start");
        const { createToolGroup } = await import("../viewer/csTools");
        createToolGroup("probe-tg", "probe-vp", "probe-re");
        mark("P3b toolgroup done");

        mark("P4 image start");
        const imageId = `web:${api.imageUrl("tech_401")}`;
        await preloadDims(imageId);
        await vp.setStack([imageId]);
        vp.resetCamera();
        vp.render();
        mark("P4 image done — ALL OK");
      } catch (e) {
        mark(`ERR ${String(e)}`);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  return (
    <div style={{ color: "#e6eaf0", font: "14px ui-monospace,monospace", padding: 20 }}>
      <div>STAGE: {stage}</div>
      <div ref={elRef} style={{ width: 512, height: 400, border: "1px solid #444", marginTop: 12 }} />
    </div>
  );
}
