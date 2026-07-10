// NIfTI 加载器接线——nifti-reader-js（社区成熟包） + CS3D IImage 适配，沿用 P2.4 `web:` 模式。
//
// CS3D 无内置 NIfTI 加载器（面向 DICOM），@cornerstonejs/nifti-volume-loader 要 core@5.x
// （本仓库是 3.33.5，跨大版本不兼容）。nifti-reader-js 是无依赖的纯 JS NIfTI 解析器，
// 我们自己把它包成 CS3D IImage。scheme 用 `nifti:` 与现有 `web:` 区分。
//
// P6 修正（review ②）：
//   - 维度映射修正——NIfTI `dims[0]` 是维数(ndim)，空间维是 dims[1]=X / dims[2]=Y / dims[3]=Z。
//     旧代码把 columns 取成 dims[0]（=3），连第 0 帧都畸变。
//   - 多帧——imageId 编码切片 `nifti:<url>#z=<i>`；整卷解析一次缓存，每帧切片是连续块，
//     setStack(每帧一个 id) + setImageIdIndex(z) 才真正换图。
//   - CT 窗位——HU 可为负；以 +1024 偏移塞进 Uint16、intercept=-1024，保住空气/软组织对比。
import * as nifti from "nifti-reader-js";

import {
  Enums,
  imageLoader,
  metaData,
  type Types,
} from "@cornerstonejs/core";

const META_PROVIDER_PRIORITY = 10000; // 同 cornerstone.ts 既有模式

// --- 整卷解析缓存（按 url，去 #z 片段） --------------------------------------

interface NiftiVolume {
  columns: number; // X = dims[1]
  rows: number; // Y = dims[2]
  slices: number; // Z = dims[3]
  display: Uint16Array; // 展示用（CT: HU+offset；label: 原值），整卷 columns*rows*slices
  raw: Int32Array; // 原始整数体素（label 着色 / 后续度量参考用）
  slope: number;
  intercept: number; // 展示 intercept（CT = scl_inter - offset）
  min: number; // display 单位下的整卷极值（供 VOI）
  max: number;
}

const volCache = new Map<string, NiftiVolume>();

function _urlOf(imageId: string): string {
  return imageId.replace(/^nifti:/, "").replace(/#z=\d+$/, "");
}
function _zOf(imageId: string): number {
  const m = imageId.match(/#z=(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function _toInt32(buf: ArrayBuffer, dtypeCode: number): Int32Array {
  // NIfTI dtype: 2=uint8, 4=int16, 8=int32, 16=float32, 64=float64, 256=int8, 512=uint16
  switch (dtypeCode) {
    case 2: return Int32Array.from(new Uint8Array(buf));
    case 256: return Int32Array.from(new Int8Array(buf));
    case 4: return Int32Array.from(new Int16Array(buf));
    case 512: return Int32Array.from(new Uint16Array(buf));
    case 8: return new Int32Array(buf);
    case 16: return Int32Array.from(new Float32Array(buf), (v) => Math.round(v));
    case 64: return Int32Array.from(new Float64Array(buf), (v) => Math.round(v));
    default: return Int32Array.from(new Uint16Array(buf));
  }
}

/** 解析整卷 NIfTI（fetch + parse 一次，按 url 缓存）。切片/维度/label 均由此派生。 */
export async function loadNiftiVolume(url: string): Promise<NiftiVolume> {
  const cached = volCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NIfTI fetch 失败：${url} → ${resp.status}`);
  let buf = await resp.arrayBuffer();
  // .nii.gz 是 gzip 压缩——nifti-reader-js 需先 decompress，否则 isNIFTI 恒 false（这是 CT/labelmap
  // 全加载失败的根因：服务端流式返回原始 .nii.gz 字节，magic 1f 8b）。
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) throw new Error(`非 NIfTI 文件：${url}`);
  const header = nifti.readHeader(buf);
  const columns = header.dims[1] ?? 1; // X
  const rows = header.dims[2] ?? 1; // Y
  const slices = header.dims[3] ?? 1; // Z
  const raw = _toInt32(nifti.readImage(header, buf), header.datatypeCode);

  const slope = header.scl_slope || 1;
  const scInter = header.scl_inter || 0;
  // 整卷极值（决定是否有负值 → CT 需偏移）。1~数百万体素，一次线性扫描即可。
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!Number.isFinite(vmin)) { vmin = 0; vmax = 0; }
  const offset = vmin < 0 ? -vmin : 0; // 有负值（CT HU）→ 平移到非负塞进 Uint16
  const display = new Uint16Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let v = raw[i] + offset;
    if (v < 0) v = 0;
    else if (v > 65535) v = 65535;
    display[i] = v;
  }
  const vol: NiftiVolume = {
    columns, rows, slices, display, raw, slope,
    intercept: scInter - offset,
    min: Math.max(0, vmin + offset),
    max: Math.min(65535, vmax + offset),
  };
  volCache.set(url, vol);
  return vol;
}

/** 让某 url 的整卷缓存失效（画笔编辑后 labelmap 已变，需重取）。 */
export function invalidateNiftiVolume(url: string): void {
  volCache.delete(url);
}

/** 取某 z 切片的 label（原始整数体素）——VolumeViewer 画分割叠色用。 */
export async function loadNiftiLabelSlice(
  url: string,
  z: number,
): Promise<{ columns: number; rows: number; data: Int32Array }> {
  const vol = await loadNiftiVolume(url);
  const sliceLen = vol.columns * vol.rows;
  const zc = Math.max(0, Math.min(vol.slices - 1, z));
  return {
    columns: vol.columns,
    rows: vol.rows,
    data: vol.raw.subarray(zc * sliceLen, (zc + 1) * sliceLen) as Int32Array,
  };
}

// --- 元数据 provider（让 StackViewport 能定位 rows/columns） ----------------

/** 预取 NIfTI 维度并填缓存（必须在 setStack 前调用）。返回 (rows, columns, slices)。 */
export async function preloadNiftiDims(imageId: string): Promise<{ rows: number; columns: number; slices: number }> {
  const vol = await loadNiftiVolume(_urlOf(imageId));
  return { rows: vol.rows, columns: vol.columns, slices: vol.slices };
}

function metaProvider(type: string, imageId: string): unknown {
  if (typeof imageId !== "string" || !imageId.startsWith("nifti:")) return undefined;
  const vol = volCache.get(_urlOf(imageId));
  const rows = vol?.rows ?? 1;
  const columns = vol?.columns ?? 1;
  if (type === "imagePixelModule") {
    return {
      samplesPerPixel: 1,
      photometricInterpretation: "MONOCHROME2",
      planarConfiguration: 0,
      rows,
      columns,
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
      rows,
      columns,
      frameOfReferenceUID: "GLAUX_NIFTI",
    };
  }
  if (type === "generalSeriesModule") return { modality: "CT" };
  if (type === "voiLutModule") return { windowCenter: 40, windowWidth: 400 }; // CT 软组织窗
  if (type === "generalImageModule") {
    return { sopInstanceUID: imageId, instanceNumber: _zOf(imageId) + 1 };
  }
  return undefined;
}

// --- Image loader —— 读 NIfTI 切片 z → Uint16 → IImage ----------------------

function niftiImageLoader(imageId: string): Types.IImageLoadObject {
  const url = _urlOf(imageId);
  const z = _zOf(imageId);
  const promise = (async (): Promise<Types.IImage> => {
    const vol = await loadNiftiVolume(url);
    const { columns, rows, slices } = vol;
    const zc = Math.max(0, Math.min(slices - 1, z));
    const sliceLen = columns * rows;
    const pixData = vol.display.subarray(zc * sliceLen, (zc + 1) * sliceLen);
    const cv = document.createElement("canvas");
    cv.width = columns;
    cv.height = rows;
    return {
      imageId,
      dataType: "Uint16Array",
      minPixelValue: vol.min,
      maxPixelValue: vol.max,
      slope: vol.slope,
      intercept: vol.intercept,
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
      numComps: 1,
    } as unknown as Types.IImage;
  })();
  return { promise } as Types.IImageLoadObject;
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
