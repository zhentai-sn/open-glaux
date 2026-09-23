import type { ComponentType } from "react";

import type { ObjectKind } from "../api/types";
import { useI18n } from "../i18n";
import { activeObject, useSession } from "../store/session";
import { CornerstoneViewer } from "./CornerstoneViewer";
import type { EngineProps } from "./viewerProps";
import { VolumeViewer } from "./VolumeViewer";
import { WsiViewer } from "./WsiViewer";

// 查看器接缝（SDD 10 §7 规则 2、D-11）——引擎只由对象几何决定：按 ObjectMeta.kind 查表，
// 不读 TaskView.viewer。本组件是查看器树中唯一读 store 处，当前对象与焦点经 props 下传。
// 缺键渲染「查看器引擎尚未接入」空态，不回落到任何缺省引擎（video 在 W6 接入）。
const ENGINES: Partial<Record<ObjectKind, ComponentType<EngineProps>>> = {
  image: CornerstoneViewer, // CS3D StackViewport（2D 影像 + 相机基座）
  volume: VolumeViewer, // CS3D StackViewport（NIfTI 按 z 层作 stack + canvas 叠 labelmap + 画笔）
  slide: WsiViewer, // 病理全切片（OpenSeadragon 深缩放 + ROI 框选 + 核 overlay）
};

export function Viewer() {
  const { t } = useI18n();
  const object = useSession((s) => activeObject(s));
  const focus = useSession((s) => s.focus);
  if (!object || !focus) return null;
  const Engine = ENGINES[object.kind];
  if (!Engine) {
    return (
      <div className="frame">
        <div className="empty">{t("viewer_engine_missing", { kind: object.kind })}</div>
      </div>
    );
  }
  return <Engine object={object} focus={focus} />;
}
