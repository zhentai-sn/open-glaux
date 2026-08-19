/**
 * Composer 图像附件（SDD 00 §4.3 / D-021）。
 *
 * 附件不落 Glaux 侧存储：读成 base64 后随 `prompt` 命令内联下发，由 Pi transcript 持久化。
 * 这里的上限与 agent-runtime `contracts.ts` 中的同名常量一一对应——UI 侧先拦一道，
 * 让用户在发送前就看到原因，runtime 侧仍独立校验（它也接受非浏览器调用方）。
 */

import type { PromptImage } from "./runtime/types";

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const MAX_IMAGE_BASE64 = 12 * 1024 * 1024;
export const MAX_IMAGES = 6;
export const MAX_IMAGES_TOTAL_BASE64 = 24 * 1024 * 1024;

export interface Attachment {
  /** 客户端本地 id，仅用于列表 key 与移除。 */
  id: string;
  name: string;
  mimeType: string;
  /** 不带 `data:` 前缀的 base64。 */
  data: string;
  /** 缩略图直接用的 data URL。 */
  dataUrl: string;
}

export type RejectReason =
  | "unsupported_type"
  | "too_large"
  | "too_many"
  | "total_too_large"
  | "read_failed";

export interface Rejection {
  name: string;
  reason: RejectReason;
}

export function isSupportedImage(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `att-${counter}-${Date.now()}`;
}

/**
 * 把一批 File/Blob 并进现有附件列表，返回新列表与逐个失败原因。
 * 超限的项被拒绝而不是静默截断——失败必须可见（G5）。
 */
export async function addFiles(
  current: Attachment[],
  files: (File | Blob)[],
): Promise<{ attachments: Attachment[]; rejected: Rejection[] }> {
  const attachments = [...current];
  const rejected: Rejection[] = [];
  let total = current.reduce((sum, item) => sum + item.data.length, 0);

  for (const file of files) {
    const name = file instanceof File && file.name ? file.name : "image";
    if (!isSupportedImage(file.type)) {
      rejected.push({ name, reason: "unsupported_type" });
      continue;
    }
    if (attachments.length >= MAX_IMAGES) {
      rejected.push({ name, reason: "too_many" });
      continue;
    }
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      rejected.push({ name, reason: "read_failed" });
      continue;
    }
    const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!data) {
      rejected.push({ name, reason: "read_failed" });
      continue;
    }
    if (data.length > MAX_IMAGE_BASE64) {
      rejected.push({ name, reason: "too_large" });
      continue;
    }
    if (total + data.length > MAX_IMAGES_TOTAL_BASE64) {
      rejected.push({ name, reason: "total_too_large" });
      continue;
    }
    total += data.length;
    attachments.push({
      id: nextId(),
      name,
      mimeType: file.type,
      data,
      dataUrl,
    });
  }
  return { attachments, rejected };
}

/** 从剪贴板事件里取图像项（截图粘贴走这条路：`items` 里是 image/png 的 File）。 */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !isSupportedImage(item.type)) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  // Safari 等浏览器在部分场景只填 files 不填 items。
  if (!out.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (isSupportedImage(file.type)) out.push(file);
    }
  }
  return out;
}

export function toPromptImages(attachments: Attachment[]): PromptImage[] {
  return attachments.map((item) => ({
    data: item.data,
    mime_type: item.mimeType,
  }));
}
