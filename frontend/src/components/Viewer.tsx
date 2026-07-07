import type { ComponentType } from "react";

import { CornerstoneViewer } from "./CornerstoneViewer";
import { useSession } from "../store/session";

// 查看器接缝——按当前任务的 `viewer` 引擎提示（注册表 /tasks 下发）分派到具体引擎组件。
// 这是消灭「isHC ? HCCanvas : AnnotationCanvas」的关键：中部展示区只认 viewer 字符串，
// 加一种查看器（3D 体渲染 / 病理 WSI / 视频）= 在 ENGINES 里加一行，Editor 一行不改。
const ENGINES: Record<string, ComponentType> = {
  raster_2d: CornerstoneViewer, // Cornerstone3D StackViewport（2D 影像 + 相机基座）
  // volume_3d: VolumeViewer,   // 放射 3D（Cornerstone3D VolumeViewport）——后接
  // wsi: WsiViewer,            // 病理全切片（OpenSeadragon）——后接
  // video: VideoViewer,        // 时序/超声视频——后接
};

export function Viewer() {
  const modality = useSession((s) => s.modality);
  const viewer = useSession((s) => s.tasks.find((t) => t.modality === modality)?.viewer ?? "raster_2d");
  const Engine = ENGINES[viewer];
  if (!Engine) {
    return (
      <div className="frame">
        <div className="empty">查看器引擎「{viewer}」尚未接入</div>
      </div>
    );
  }
  return <Engine />;
}
