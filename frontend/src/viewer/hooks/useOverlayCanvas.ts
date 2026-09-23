import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { Enums, type RenderingEngine, type Types } from "../cornerstone";

/** 相机和容器尺寸变化时保持 CS3D 叠加画布对齐。 */
export function useOverlayCanvas(
  ready: boolean,
  elementRef: RefObject<HTMLDivElement | null>,
  engineRef: RefObject<RenderingEngine | null>,
  viewportRef: RefObject<Types.IStackViewport | null>,
  draw: () => void,
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const element = elementRef.current;
    if (!ready || !element) return;
    const redraw = () => drawRef.current();
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, redraw);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, redraw);
    const observer = new ResizeObserver(() => {
      const engine = engineRef.current;
      const viewport = viewportRef.current;
      if (!engine || !viewport || element.clientWidth === 0 || element.clientHeight === 0) return;
      try {
        engine.resize(true, false);
        viewport.render();
      } catch {
        /* The viewport may be between teardown and remount. */
      }
      redraw();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, redraw);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, redraw);
    };
  }, [ready, elementRef, engineRef, viewportRef]);
}
