/**
 * 查看器上下文与观测通道的测试助手（SDD 10 W0 安全网）。
 *
 * 工具测试只经这里表达四件事，不直接读写 `image_id` / `modality` / `cubs_cf` / `roi_box`
 * 等过渡字段：
 * - 查看器打开了哪个对象、带什么任务 / 标定 / 区域（`viewerOn`）；
 * - 工具取了哪个对象的观测图（`observedObjectId`）；
 * - 工具产出或写库请求指向哪个对象（`targetObjectId`）；
 * - `run_task` 发出的任务请求的语义投影（`taskSpecOf`）。
 *
 * W5 把 `ViewerContext` 收敛为 `{collection, task, method, object, focus}`、取图改走
 * `GET /objects/{id}/frame` 时，只改本文件的取值方式，不改各测试的断言语义。
 */

import { crc32, deflateSync } from "node:zlib";

import type { ViewerContext } from "../../src/contracts.js";

/** 各类对象的夹具 id；前缀与 backend 现行的 ID 判别约定一致（`ct_` / `slide_` / `vid-`）。 */
export const FIXTURE_OBJECT_IDS = {
  image: "tech_0450",
  ct: "ct_0001",
  slide: "slide_001",
  video: "vid-0001",
} as const;

/** SDD 10 §9.1 `Region` 的 `box` 分支：`(x0, y0, x1, y1)`，level-0 / 帧像素（D-9）。 */
export interface BoxRegion {
  kind: "box";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** SDD 10 §9.1 `Calibration` 的平面标定子集（过渡期唯一能经 ViewerContext 下发的一种）。 */
export interface PlanarCalibration {
  kind: "mm_per_px";
  value: number;
}

export interface ViewerSpec {
  /** 数据集路由键（SDD 10 D-3：runtime 侧叫 `collection`）。 */
  collection?: string;
  task?: string;
  method?: string;
  calibration?: PlanarCalibration;
  region?: BoxRegion;
}

/**
 * 构造「查看器当前打开对象 `objectId`」的上下文。
 * 现映射到过渡字段；W5 改为产出 `object` + `focus`。
 */
export function viewerOn(objectId: string, spec: ViewerSpec = {}): ViewerContext {
  const viewer: ViewerContext = { image_id: objectId };
  if (spec.collection !== undefined) viewer.modality = spec.collection;
  if (spec.task !== undefined) viewer.task = spec.task;
  if (spec.method !== undefined) viewer.method = spec.method;
  if (spec.calibration) viewer.cubs_cf = spec.calibration.value;
  if (spec.region) {
    const { x0, y0, x1, y1 } = spec.region;
    viewer.roi_box = [x0, y0, x1, y1];
  }
  return viewer;
}

/** 构造一个 `box` 区域（角点语义，D-9）。 */
export function boxRegion(x0: number, y0: number, x1: number, y1: number): BoxRegion {
  return { kind: "box", x0, y0, x1, y1 };
}

/**
 * 一次 fetch 若是「取某对象的观测图」，返回该对象 id；否则 `undefined`。
 * 现认 `GET /image/{id}`；W5 改认 `GET /objects/{id}/frame`。
 */
export function observedObjectId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const match = /^\/image\/([^/]+)$/u.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

/** 工具结果 payload 或写库请求体所指向的对象 id（D-8：线上字段名 `image_id` 保留，语义为对象 id）。 */
export function targetObjectId(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const id = (record as { image_id?: unknown }).image_id;
  return typeof id === "string" ? id : undefined;
}

/**
 * `run_task` 发往 `/task/run` 的请求体的语义投影：对象、任务、方法、标定、区域。
 * 未识别的字段原样保留在投影里，因此 `toEqual` 仍能发现多出来的字段。
 * 现从过渡字段 `image_id` / `cubs_cf` / `roi_box` 读取；W5 改读 `calibration` / `region`。
 */
export function taskSpecOf(body: unknown): Record<string, unknown> {
  const { image_id, cubs_cf, roi_box, ...rest } = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (image_id !== undefined) out.object_id = image_id;
  if (cubs_cf !== undefined) out.calibration = { kind: "mm_per_px", value: cubs_cf };
  if (roi_box !== undefined) {
    const [x0, y0, x1, y1] = roi_box as number[];
    out.region = { kind: "box", x0, y0, x1, y1 };
  }
  return out;
}

// ---- W5 预留：GET /objects/{id}/frame 桩（SDD 10 §5.2 / §9.1 ReferenceFrame）----

export interface ReferenceFrameHeader {
  object_id: string;
  index: { z?: number; t?: number; level?: number };
  origin: [number, number];
  scale: number;
  width: number;
  height: number;
}

/** 生成一张合法的 8 位灰度 PNG（全黑），IHDR 宽高即参数。 */
export function solidPng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height); // 每行 1 字节 filter=0 + 像素
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 48;

/**
 * `GET /objects/{id}/frame` 的桩：非该路由返回 `undefined`，便于在各 fakeBackend 里前置一行接入。
 * 响应为小 PNG，`X-Glaux-Frame` 为 `ReferenceFrame` 紧凑 JSON；`index` 取自查询参数
 * `z` / `t` / `level`，`origin` 取自 `roi=x0,y0,x1,y1` 的左上角（缺省 `[0, 0]`），`scale` 恒为 1。
 * W0 尚无工具调用它。
 */
export function objectFrameStub(url: string): Response | undefined {
  const u = new URL(url);
  const match = /^\/objects\/([^/]+)\/frame$/u.exec(u.pathname);
  if (!match) return undefined;
  const index: ReferenceFrameHeader["index"] = {};
  for (const axis of ["z", "t", "level"] as const) {
    const raw = u.searchParams.get(axis);
    if (raw !== null) index[axis] = Number(raw);
  }
  const roi = u.searchParams.get("roi")?.split(",").map(Number);
  const frame: ReferenceFrameHeader = {
    object_id: decodeURIComponent(match[1]!),
    index,
    origin: roi && roi.length === 4 ? [roi[0]!, roi[1]!] : [0, 0],
    scale: 1,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  };
  return new Response(Buffer.from(solidPng(FRAME_WIDTH, FRAME_HEIGHT)), {
    headers: { "content-type": "image/png", "x-glaux-frame": JSON.stringify(frame) },
  });
}
