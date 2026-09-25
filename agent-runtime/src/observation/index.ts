/** SDD 10 §6.4：runtime 唯一取帧入口。坐标以 X-Glaux-Frame 为准。 */
import type { Focus, Index, Observation, ReferenceFrame, Region } from "../contracts.js";
import { RuntimeError } from "../errors.js";

export interface ObservationOptions { size?: number; signal?: AbortSignal; fetch?: typeof globalThis.fetch }

function unavailable(message: string): never {
  throw new RuntimeError("image_unavailable", message, 502);
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function parseFrame(raw: string | null, focus: Focus): ReferenceFrame {
  if (!raw) unavailable("取图响应缺少 X-Glaux-Frame 坐标头");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { unavailable("X-Glaux-Frame 不是合法 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable("X-Glaux-Frame 形状非法");
  const frame = value as Record<string, unknown>;
  if (frame.object_id !== focus.object_id) unavailable("X-Glaux-Frame 对象与请求不一致");
  const index = frame.index;
  if (!index || typeof index !== "object" || Array.isArray(index)) unavailable("X-Glaux-Frame.index 形状非法");
  const parsedIndex: Index = {};
  for (const axis of ["z", "t", "level"] as const) {
    const n = (index as Record<string, unknown>)[axis];
    if (n === undefined || n === null) continue;
    if (!Number.isInteger(n) || (n as number) < 0) unavailable(`X-Glaux-Frame.index.${axis} 非法`);
    parsedIndex[axis] = n as number;
  }
  for (const axis of ["z", "t", "level"] as const) {
    if ((parsedIndex[axis] ?? null) !== (focus.index[axis] ?? null)) unavailable(`X-Glaux-Frame.index.${axis} 与焦点不一致`);
  }
  const origin = frame.origin;
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(finite)) unavailable("X-Glaux-Frame.origin 非法");
  if (!finite(frame.scale) || frame.scale <= 0) unavailable("X-Glaux-Frame.scale 非法");
  if (!Number.isInteger(frame.width) || (frame.width as number) <= 0 || !Number.isInteger(frame.height) || (frame.height as number) <= 0) unavailable("X-Glaux-Frame 尺寸非法");
  return { object_id: focus.object_id, index: parsedIndex, origin: origin as [number, number], scale: frame.scale, width: frame.width as number, height: frame.height as number };
}

export async function fetchObservation(base: string, focus: Focus, opts: ObservationOptions = {}): Promise<Observation> {
  const url = new URL(`${base.replace(/\/+$/u, "")}/objects/${encodeURIComponent(focus.object_id)}/frame`);
  for (const axis of ["z", "t", "level"] as const) {
    const value = focus.index[axis];
    if (value !== undefined && value !== null) url.searchParams.set(axis, String(value));
  }
  if (focus.region?.kind === "box") {
    const { x0, y0, x1, y1 } = focus.region;
    // 标注可存浮点对象坐标，frame 端点按离散像素接收整数 ROI；向外取整以完整包含选区。
    url.searchParams.set("roi", [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)].join(","));
  }
  if (opts.size !== undefined) url.searchParams.set("size", String(opts.size));
  const response = await (opts.fetch ?? fetch)(url, opts.signal ? { signal: opts.signal } : {});
  if (!response.ok) unavailable(`取图失败：HTTP ${response.status}（object_id=${focus.object_id}）`);
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  if (mime !== "image/png" && mime !== "image/jpeg") unavailable(`取图返回不支持的 MIME：${mime}`);
  const frame = parseFrame(response.headers.get("X-Glaux-Frame"), focus);
  const rawTime = response.headers.get("X-Glaux-Frame-Time");
  const time = rawTime === null ? undefined : Number(rawTime);
  if (time !== undefined && (!Number.isInteger(time) || time < 0)) unavailable("X-Glaux-Frame-Time 非法");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) unavailable("取图返回空字节");
  return { bytes, mime, frame, ...(time !== undefined ? { time_ms: time } : {}) };
}

/** 返回对象像素坐标，不把帧尺寸当作对象尺寸。 */
export function toObjectCoords(box: [number, number, number, number], frame: ReferenceFrame): Extract<Region, { kind: "box" }> {
  if (box.some((n) => !finite(n)) || box[0] >= box[2] || box[1] >= box[3]) unavailable("观测框坐标非法");
  const [ox, oy] = frame.origin;
  const s = frame.scale;
  return { kind: "box", x0: ox + box[0] / s, y0: oy + box[1] / s, x1: ox + box[2] / s, y1: oy + box[3] / s };
}

export function toObjectPoint(point: [number, number], frame: ReferenceFrame): [number, number] {
  return [frame.origin[0] + point[0] / frame.scale, frame.origin[1] + point[1] / frame.scale];
}
