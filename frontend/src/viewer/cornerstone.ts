// Cornerstone3D 接线——一次性 init + `web:` 方案 PNG 加载器 + 元数据 provider。
// CS3D 无内置 PNG 加载器（面向 DICOM），故自写：取同源 /api/image PNG → 离屏 canvas 抽 RGB →
// 返回 v3 IImage；配套元数据（spacing=1、原点=0、RGB）让 StackViewport 能定位与显示。
// 像素↔世界坐标交给 CS3D utilities（imageToWorldCoords/worldToImageCoords），避免自行推导错位。
import {
  Enums,
  RenderingEngine,
  imageLoader,
  init as coreInit,
  metaData,
  utilities as csUtils,
  type Types,
} from "@cornerstonejs/core";

// 图像尺寸缓存——元数据 provider 在像素模块里要用；组件在 setStack 前预取，规避先后次序问题。
const dimCache = new Map<string, { rows: number; columns: number }>();

/** 同一帧栈尺寸由对象 axes 约束；在 setStack 前为各帧登记尺寸，避免未解码帧按 1×1 建几何。 */
export function primeFrameDims(imageIds: string[], dims: { rows: number; columns: number }): void {
  for (const imageId of imageIds) if (imageId.startsWith("web:")) dimCache.set(imageId, dims);
}

/** 预取 PNG 尺寸并填缓存（在 setStack 前调用，保证元数据有 rows/columns）。 */
export function preloadDims(imageId: string): Promise<{ rows: number; columns: number }> {
  const cached = dimCache.get(imageId);
  if (cached) return Promise.resolve(cached);
  const url = imageId.replace(/^web:/, "");
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      const dim = { rows: el.naturalHeight, columns: el.naturalWidth };
      dimCache.set(imageId, dim);
      resolve(dim);
    };
    el.onerror = reject;
    el.src = url;
  });
}

function webImageLoader(imageId: string): Types.IImageLoadObject {
  const url = imageId.replace(/^web:/, "");
  const promise = new Promise<Types.IImage>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      const columns = el.naturalWidth;
      const rows = el.naturalHeight;
      dimCache.set(imageId, { rows, columns });
      const cv = document.createElement("canvas");
      cv.width = columns;
      cv.height = rows;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(el, 0, 0);
      const rgba = ctx.getImageData(0, 0, columns, rows).data;
      const pixelData = new Uint8Array(columns * rows * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        pixelData[j] = rgba[i];
        pixelData[j + 1] = rgba[i + 1];
        pixelData[j + 2] = rgba[i + 2];
      }
      const image = {
        imageId,
        dataType: "Uint8Array",
        minPixelValue: 0,
        maxPixelValue: 255,
        slope: 1,
        intercept: 0,
        windowCenter: 128,
        windowWidth: 256,
        getPixelData: () => pixelData,
        getCanvas: () => cv,
        rows,
        columns,
        height: rows,
        width: columns,
        color: true,
        rgba: false,
        numberOfComponents: 3,
        columnPixelSpacing: 1,
        rowPixelSpacing: 1,
        invert: false,
        sizeInBytes: pixelData.byteLength,
        voiLUTFunction: undefined,
      };
      resolve(image as unknown as Types.IImage);
    };
    el.onerror = (e) => reject(e);
    el.src = url;
  });
  return { promise } as Types.IImageLoadObject;
}

function metaProvider(type: string, imageId: string): unknown {
  if (typeof imageId !== "string" || !imageId.startsWith("web:")) return undefined;
  const dim = dimCache.get(imageId) ?? { rows: 1, columns: 1 };
  if (type === "imagePixelModule") {
    return {
      samplesPerPixel: 3,
      photometricInterpretation: "RGB",
      planarConfiguration: 0,
      rows: dim.rows,
      columns: dim.columns,
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      pixelRepresentation: 0,
    };
  }
  if (type === "imagePlaneModule") {
    return {
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      imagePositionPatient: [0, 0, 0],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      pixelSpacing: [1, 1],
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
      rows: dim.rows,
      columns: dim.columns,
      frameOfReferenceUID: "GLAUX_2D",
    };
  }
  if (type === "generalSeriesModule") return { modality: "US" };
  if (type === "voiLutModule") return { windowCenter: 128, windowWidth: 256 };
  return undefined;
}

let _ready: Promise<void> | null = null;

/** 一次性初始化（懒执行、幂等）：coreInit + 注册 web 加载器与元数据 provider。 */
export function csReady(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      await coreInit();
      imageLoader.registerImageLoader("web", webImageLoader as unknown as Parameters<typeof imageLoader.registerImageLoader>[1]);
      metaData.addProvider(metaProvider, 10000);
    })();
  }
  return _ready;
}

export { Enums, RenderingEngine, csUtils };
export type { Types };
