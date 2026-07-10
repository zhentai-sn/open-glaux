// OpenSeadragon 接线（P7）——病理 WSI 深缩放查看器。独立于 CS3D（3.33.5 无 WSI 能力）。
//
// 关键差异 vs CS3D：OSD 自处理金字塔瓦片调度 + 深缩放；我们用**自定义 tileSource**
// （getTileUrl → 后端 /wsi/{id}/tile/{level}/{col}/{row}），绕开 DZI 的 `_files` 派生约定，
// 走干净 REST。坐标：level-0 px（质心/ROI 真相）↔ OSD viewport（归一化）经 imageToViewerElement。
import OpenSeadragon from "openseadragon";

import { api } from "../api/client";

// 与后端 dataset_wsi.TILE_SIZE / OVERLAP 对齐（DeepZoomGenerator 参数）。
export const WSI_TILE_SIZE = 256;
export const WSI_TILE_OVERLAP = 1;

/** 由 slide id + level-0 尺寸构造 OSD 自定义 tileSource（DeepZoom level == OSD level）。 */
export function makeWsiTileSource(
  slideId: string,
  width: number,
  height: number,
): OpenSeadragon.TileSourceOptions {
  return {
    width,
    height,
    tileSize: WSI_TILE_SIZE,
    tileOverlap: WSI_TILE_OVERLAP,
    minLevel: 0,
    // maxLevel 缺省由 OSD 从 width/height/tileSize 推（= DeepZoom level_count-1，二者算法一致）。
    getTileUrl: (level: number, x: number, y: number) => api.wsiTileUrl(slideId, level, x, y),
  } as unknown as OpenSeadragon.TileSourceOptions;
}

/** 建一个 OSD viewer（无导航条按钮、启用鼠标滚轮缩放、无默认动画抖动）。 */
export function makeWsiViewer(element: HTMLElement): OpenSeadragon.Viewer {
  return OpenSeadragon({
    element,
    prefixUrl: "", // 不用内置按钮图标（无 UI 控件，避免外链图标 404）
    showNavigationControl: false,
    showNavigator: true,
    navigatorPosition: "BOTTOM_RIGHT",
    navigatorSizeRatio: 0.12,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
    animationTime: 0.4,
    springStiffness: 8,
    minZoomImageRatio: 0.6,
    // 最多放大到原生 1.5×——demo slide 是单分辨率层（无更深金字塔），再放大只是插值糊化。
    // 真·多层 WSI（多物镜层）可调高；此值仅决定"允许缩放到多糊"，不影响瓦片拉取。
    maxZoomPixelRatio: 1.5,
    visibilityRatio: 0.7,
  });
}

export { OpenSeadragon };
