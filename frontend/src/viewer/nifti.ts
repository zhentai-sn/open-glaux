// NIfTI 加载器接线——nifti-reader-js（社区成熟包） + CS3D IImage 适配，沿用 P2.4 `web:` 模式。
//
// CS3D 无内置 NIfTI 加载器（面向 DICOM），@cornerstonejs/nifti-volume-loader 要 core@5.x
// （本仓库是 3.33.5，跨大版本不兼容）。nifti-reader-js 是无依赖的纯 JS NIfTI 解析器，
// 我们自己把它包成 CS3D IImage。scheme 用 `nifti:` 与现有 `web:` 区分。
import * as nifti from "nifti-reader-js";

import {
  Enums,
  imageLoader,
  metaData,
  type Types,
} from "@cornerstonejs/core";

// --- 元数据 provider（让 StackViewport / OrthographicViewport 能定位） ---

const META_PROVIDER_PRIORITY = 10000; // 同 cornerstone.ts 既有模式
const dimCache = new Map<string, { rows: number; columns: number; slices: number }>();

/** 预取 NIfTI header 并填缓存（必须在 setStack 前调用，否则元数据 0×0 警告）。 */
export async function preloadNiftiDims(imageId: string): Promise<{ rows: number; columns: number; slices: number }> {
  const cached = dimCache.get(imageId);
  if (cached) return cached;
  const url = imageId.replace(/^nifti:/, "");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NIfTI fetch 失败：${url} → ${resp.status}`);
  const buf = await resp.arrayBuffer();
  if (!nifti.isNIFTI(buf)) throw new Error(`非 NIfTI 文件：${url}`);
  const header = nifti.readHeader(buf);
  const dim = {
    rows: header.dims[1] ?? 1,
    columns: header.dims[0] ?? 1,
    slices: header.dims[2] ?? 1,
  };
  dimCache.set(imageId, dim);
  return dim;
}

function metaProvider(type: string, imageId: string): unknown {
  if (typeof imageId !== "string" || !imageId.startsWith("nifti:")) return undefined;
  const dim = dimCache.get(imageId) ?? { rows: 1, columns: 1, slices: 1 };
  if (type === "imagePixelModule") {
    return {
      samplesPerPixel: 1,
      photometricInterpretation: "MONOCHROME2",
      planarConfiguration: 0,
      rows: dim.rows,
      columns: dim.columns,
      bitsAllocated: 16,
      bitsStored: 16,
      highBit: 15,
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
      frameOfReferenceUID: "GLAUX_NIFTI",
    };
  }
  if (type === "generalSeriesModule") return { modality: "CT" };
  if (type === "voiLutModule") return { windowCenter: 40, windowWidth: 400 };  // CT 软组织窗
  if (type === "generalImageModule") {
    return {
      sopInstanceUID: imageId,
      // 让 CS3D 把多 slice 视为同一 series
      instanceNumber: 1,
    };
  }
  return undefined;
}

// --- Image loader —— 读 NIfTI → Uint16Array → IImage ------------------------

function niftiImageLoader(imageId: string): Types.IImageLoadObject {
  const url = imageId.replace(/^nifti:/, "");
  const promise = new Promise<Types.IImage>((resolve, reject) => {
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          reject(new Error(`NIfTI fetch ${resp.status}`));
          return;
        }
        const buf = await resp.arrayBuffer();
        if (!nifti.isNIFTI(buf)) {
          reject(new Error(`非 NIfTI 文件：${url}`));
          return;
        }
        const header = nifti.readHeader(buf);
        const dataArr = nifti.readImage(header, buf);
        // nifti-reader-js 返回 ArrayBuffer；按 header.datatypeCode 转 typed view
        const pixData = _toTypedArray(dataArr, header.datatypeCode);
        const rows = header.dims[1] ?? 1;
        const columns = header.dims[0] ?? 1;
        const slices = header.dims[2] ?? 1;
        dimCache.set(imageId, { rows, columns, slices });
        // CT 窗位：voxel value ≈ Hounsfield Unit（scaled by header.scl_slope + scl_inter）
        const slope = header.scl_slope || 1;
        const intercept = header.scl_inter || 0;
        const minVal = pixData.length ? (pixData[0] * slope + intercept) : 0;
        const maxVal = pixData.length ? (pixData[pixData.length - 1] * slope + intercept) : 255;
        // 单 canvas 给 getCanvas（CS3D 偶有需要）
        const cv = document.createElement("canvas");
        cv.width = columns;
        cv.height = rows;
        const image = {
          imageId,
          dataType: "Uint16Array",
          minPixelValue: minVal,
          maxPixelValue: maxVal,
          slope,
          intercept,
          windowCenter: 40,
          windowWidth: 400,
          getPixelData: () => pixData,
          getCanvas: () => cv,
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
          sizeInBytes: pixData.byteLength,
          voiLUTFunction: "LINEAR",
          // 3D 信息：CS3D 5.x 用 frameIndex / numFrames，3.33.5 忽略
          numComps: 1,
        } as unknown as Types.IImage;
        resolve(image);
      } catch (e) {
        reject(e);
      }
    })();
  });
  return { promise } as Types.IImageLoadObject;
}

function _toTypedArray(buf: ArrayBuffer, dtypeCode: number): Uint16Array {
  // NIfTI dtype code: 2=uint8, 4=int16, 8=int32, 16=float32, 64=float64, 512=uint16
  switch (dtypeCode) {
    case 2: {
      const v = new Uint8Array(buf);
      const out = new Uint16Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i];
      return out;
    }
    case 4: return new Uint16Array(buf);
    case 512: return new Uint16Array(buf);
    case 8: {
      const v = new Int32Array(buf);
      const out = new Uint16Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i] < 0 ? 0 : v[i];
      return out;
    }
    case 16: {
      const v = new Float32Array(buf);
      const out = new Uint16Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i] < 0 ? 0 : v[i] | 0;
      return out;
    }
    default: return new Uint16Array(buf);
  }
}

// --- 一次性 init（沿 cornerstone.ts 模式） --------------------------------

let _niftiReady: Promise<void> | null = null;

/** 一次性初始化（懒执行、幂等）：注册 nifti 加载器 + 元数据 provider。 */
export function niftiReady(): Promise<void> {
  if (!_niftiReady) {
    _niftiReady = (async () => {
      // 注意：CS3D core 已由 csReady() 初始化；这里只挂 loader + meta provider
      imageLoader.registerImageLoader("nifti", niftiImageLoader as unknown as Parameters<typeof imageLoader.registerImageLoader>[1]);
      metaData.addProvider(metaProvider, META_PROVIDER_PRIORITY);
    })();
  }
  return _niftiReady;
}

export { Enums as NiftiEnums };
export type { Types };
