import { useCallback, useEffect, useMemo } from "react";

import type { ObjectKind } from "../api/types";
import { useI18n } from "../i18n";
import { activeObject, useSession } from "../store/session";
import { FrameStackViewer } from "../viewer/FrameStackViewer";
import { PyramidViewer } from "../viewer/PyramidViewer";
import { PAINTERS } from "../viewer/overlay/painters";
import { frameAxisFor, type ViewerEngine } from "../viewer/contract";
import { frameSourceFor } from "../viewer/frameSources";
import { annotationMaskSink, editMaskSink } from "../viewer/maskSinks";
import { useTaskTools } from "../viewer/useTaskTools";

// 查看器接缝（SDD 10 §7 规则 2、D-11）——引擎只由对象几何决定：按 ObjectMeta.kind 查表，
// 引擎由对象 kind 选择。本组件是查看器树中唯一读 store 处，当前对象与焦点经 props 下传。
// 缺键渲染「查看器引擎尚未接入」空态，不回落到任何缺省引擎。
const ENGINES: Partial<Record<ObjectKind, ViewerEngine>> = {
  image: FrameStackViewer,
  volume: FrameStackViewer,
  video: FrameStackViewer,
  slide: PyramidViewer, // 病理全切片（OpenSeadragon 深缩放 + ROI 框选 + 核 overlay）
};

export function Viewer() {
  const { t } = useI18n();
  const object = useSession((s) => activeObject(s));
  const focus = useSession((s) => s.focus);
  const primitives = useSession((s) => s.primitives);
  const annotations = useSession((s) => s.annotations);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const setIndex = useSession((s) => s.setIndex);
  const setCoords = useSession((s) => s.setCoords);
  const notify = useSession((s) => s.notify);
  const { task, capabilities } = useTaskTools();
  const source = useMemo(() => object ? frameSourceFor(object) : null, [object]);
  const maskSink = useMemo(() => {
    if (!object) return null;
    if (object.kind !== "volume" || !task) return annotationMaskSink(object.id);
    return editMaskSink({
      objectId: object.id,
      task,
      method: () => useSession.getState().activeModel ?? task.default_method,
      brush: () => {
        const { classId, mode } = useSession.getState().toolOptions.brush;
        return { classId, mode };
      },
      onSaved: async (response) => { useSession.getState().setMetrics(response.metrics); },
      notify: (message) => useSession.getState().notify("crit", message),
    });
  }, [object, task]);
  const onCoords = useCallback((coords: { x: number; y: number; z?: number | null; t?: number | null; level?: number | null }) => {
    const { x, y, ...index } = coords;
    setCoords(x, y, index);
  }, [setCoords]);
  const onRegion = useCallback((region: Parameters<ReturnType<typeof useSession.getState>["setRegion"]>[0]) => {
    const state = useSession.getState();
    if (state.focus?.object_id === object?.id) state.setRegion(region);
  }, [object?.id]);
  useEffect(() => {
    if (!focus) return;
    const coords = useSession.getState().coords;
    setCoords(coords.x, coords.y, focus.index);
  }, [focus?.index, setCoords]);
  if (!object || !focus) return null;
  const Engine = ENGINES[object.kind];
  if (!Engine) {
    return (
      <div className="frame">
        <div className="empty">{t("viewer_engine_missing", { kind: object.kind })}</div>
      </div>
    );
  }
  const axis = frameAxisFor(object, focus, setIndex);
  return <Engine object={object} focus={focus} task={task} capabilities={capabilities} source={source!} axis={axis}
    voi={capabilities.includes("voi") ? toolOptions.voi : null} primitives={primitives} annotations={annotations}
    tool={tool} toolOptions={toolOptions} maskSink={maskSink!} painters={PAINTERS} onCoords={onCoords}
    onRegion={onRegion} notify={notify} />;
}
