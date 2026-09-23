import { useEffect, useRef, useState } from "react";

import { attachCsAnnoBridge, resetCsAnnoBridge, type CsAnnoBridgeOpts } from "../../annotation/csAnno";
import { csReady, Enums, RenderingEngine, type Types } from "../cornerstone";
import { createToolGroup, csToolsReady, destroyToolGroup } from "../csTools";
import { niftiReady } from "../nifti";

interface StackEngineOptions extends CsAnnoBridgeOpts {
  renderingEngineId: string;
  viewportId: string;
  toolGroupId: string;
  nifti?: boolean;
}

/** CS3D StackViewport 与标注桥的单一挂载生命周期。 */
export function useCsStackEngine(options: StackEngineOptions) {
  const elementRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const viewportRef = useRef<Types.IStackViewport | null>(null);
  const [ready, setReady] = useState(false);
  const current = useRef(options);
  current.current = options;
  const { renderingEngineId, viewportId, toolGroupId, nifti } = options;

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | null = null;
    (async () => {
      await csReady();
      if (nifti) await niftiReady();
      await csToolsReady();
      if (disposed || !elementRef.current) return;
      const engine = new RenderingEngine(renderingEngineId);
      engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element: elementRef.current });
      engineRef.current = engine;
      viewportRef.current = engine.getViewport(viewportId) as Types.IStackViewport;
      createToolGroup(toolGroupId, viewportId, renderingEngineId);
      detach = attachCsAnnoBridge({
        getImageId: () => current.current.getImageId(),
        pixelMap: current.current.pixelMap ? () => current.current.pixelMap!() : undefined,
        toTarget: (imageId) => current.current.toTarget(imageId),
      });
      setReady(true);
    })();
    return () => {
      disposed = true;
      detach?.();
      destroyToolGroup(toolGroupId);
      resetCsAnnoBridge();
      try {
        engineRef.current?.destroy();
      } catch {
        /* CS3D may already have disposed during StrictMode remount. */
      }
      engineRef.current = null;
      viewportRef.current = null;
    };
  }, [renderingEngineId, viewportId, toolGroupId, nifti]);

  return { elementRef, engineRef, viewportRef, ready };
}
