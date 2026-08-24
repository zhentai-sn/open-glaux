/**
 * 图像入模型的单轮调用（SDD 03 §7.6 描述生成 / §6.3 两步中的"挑选"步）。
 *
 * agent-runtime 此前只把 `image_id` 字符串交给工具，从不向模型发像素；本模块是首个
 * "像素 → 模型"通道，同时是 SDD 02 `locate_roi` 的前置能力。
 *
 * 实现基于 pi-ai 的 `ImageContent {type:"image", data(base64), mimeType}`——已核实
 * anthropic-messages / openai-completions 两条路径对用户消息中的图像块无条件转换。
 * 输出要求 JSON；解析失败重试一次后抛 `RuntimeError("describe_failed" | "select_failed")`。
 */

import type { ImageContent, Model, Models, TextContent } from "@earendil-works/pi-ai";

import { RuntimeError } from "../errors.js";

export interface VisionRuntime {
  models: Models;
  model: Model<string>;
}

export interface ImageInput {
  /** base64（不带 data: 前缀） */
  data: string;
  mimeType?: string;
}

/** SDD 03 §7.6：固定字段 + 扩展字段。 */
export interface AtlasDescription {
  modality: string;
  subject: string;
  findings: { name: string; location?: string; appearance?: string }[];
  pattern: string;
  summary: string;
  extra: Record<string, unknown>;
}

export const DESCRIPTION_STATEMENT_VERSION = "v1";

const DESCRIBE_SYSTEM = [
  "You are a biomedical image curator building an illustrated atlas.",
  "Describe the given image for later retrieval by text search.",
  "Answer with ONE JSON object only (no markdown, no prose) with exactly these keys:",
  '{"modality": string, "subject": string, "findings": [{"name": string, "location": string, "appearance": string}],',
  ' "pattern": string, "summary": string, "extra": {string: string}}',
  "- modality: imaging method (e.g. TEM, ultrasound, CT, H&E). Infer from the image.",
  "- subject: the main structure shown.",
  "- findings: key observations; name = the finding term a pathologist would search for.",
  "- pattern: overall distribution / morphology pattern.",
  "- summary: one sentence suitable for full-text search.",
  "- extra: any other salient key facts you can infer (magnification, stain, artifacts, laterality...). Use an empty object if none.",
  "Write field values in the same language as the hint when a hint is given; otherwise use Chinese.",
].join("\n");

const SELECT_SYSTEM = [
  "You are helping a biomedical image agent pick reference examples from an atlas.",
  "The FIRST image is the target. The following images are candidates, each labelled with an id and a short summary.",
  "Choose the candidates most visually similar to the target for the same kind of structure.",
  'Answer with ONE JSON object only: {"selected": [id, ...]} — ids must come from the candidate list, most similar first.',
].join("\n");

function img(input: ImageInput): ImageContent {
  return { type: "image", data: input.data, mimeType: input.mimeType ?? "image/png" };
}

function txt(text: string): TextContent {
  return { type: "text", text };
}

function assistantText(msg: { content: unknown }): string {
  const content = msg.content as { type: string; text?: string }[] | string;
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

/** 宽松抽 JSON：去 ```json 围栏、取第一个 { 到最后一个 }。 */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/giu, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object in model output");
  return JSON.parse(stripped.slice(start, end + 1));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/** 把模型输出规整成 §7.6 形状；缺字段补空、`extra` 强制为对象。 */
export function normalizeDescription(raw: unknown): AtlasDescription {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SyntaxError("description must be an object");
  }
  const o = raw as Record<string, unknown>;
  const findingsRaw = Array.isArray(o.findings) ? o.findings : [];
  const findings = findingsRaw
    .map((f) => {
      if (typeof f === "string") return { name: f.trim() };
      if (f && typeof f === "object") {
        const g = f as Record<string, unknown>;
        return {
          name: asString(g.name),
          ...(g.location != null ? { location: asString(g.location) } : {}),
          ...(g.appearance != null ? { appearance: asString(g.appearance) } : {}),
        };
      }
      return { name: "" };
    })
    .filter((f) => f.name);
  const extraRaw = o.extra;
  const extra: Record<string, unknown> =
    extraRaw && typeof extraRaw === "object" && !Array.isArray(extraRaw)
      ? (extraRaw as Record<string, unknown>)
      : {};
  return {
    modality: asString(o.modality),
    subject: asString(o.subject),
    findings,
    pattern: asString(o.pattern),
    summary: asString(o.summary),
    extra,
  };
}

export async function completeJson(
  rt: VisionRuntime,
  systemPrompt: string,
  content: (TextContent | ImageContent)[],
  signal: AbortSignal | undefined,
  errorCode: string,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = [
      { role: "user" as const, content, timestamp: Date.now() },
      ...(attempt > 0
        ? [
            {
              role: "user" as const,
              content: [txt("Your previous answer was not valid JSON. Reply with the JSON object only.")],
              timestamp: Date.now(),
            },
          ]
        : []),
    ];
    try {
      const msg = await rt.models.complete(
        rt.model,
        { systemPrompt, messages },
        signal ? { signal } : undefined,
      );
      if (msg.stopReason === "error") {
        throw new RuntimeError(errorCode, msg.errorMessage ?? "model returned an error", 502);
      }
      return extractJson(assistantText(msg));
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new RuntimeError(errorCode, `model output was not valid JSON: ${reason}`, 502);
}

export async function describeImage(
  rt: VisionRuntime,
  input: { image: ImageInput; hint?: string; signal?: AbortSignal },
): Promise<AtlasDescription> {
  const content: (TextContent | ImageContent)[] = [img(input.image)];
  content.push(txt(input.hint?.trim() ? `Hint: ${input.hint.trim()}` : "Describe this image."));
  const raw = await completeJson(rt, DESCRIBE_SYSTEM, content, input.signal, "describe_failed");
  try {
    return normalizeDescription(raw);
  } catch (error) {
    throw new RuntimeError("describe_failed", (error as Error).message, 502);
  }
}

export interface SelectCandidate {
  id: string;
  image: ImageInput;
  summary?: string;
}

/**
 * 两步 VLM 的第一步：从候选里挑最相似的 ≤ k 张。返回按相似度排序的 id 列表（只含合法 id）。
 */
export async function chooseAmongImages(
  rt: VisionRuntime,
  input: { target: ImageInput; candidates: SelectCandidate[]; k?: number; signal?: AbortSignal },
): Promise<string[]> {
  const k = Math.max(1, Math.min(input.k ?? 3, input.candidates.length));
  if (input.candidates.length === 0) return [];
  const content: (TextContent | ImageContent)[] = [txt("Target image:"), img(input.target)];
  input.candidates.forEach((c, i) => {
    content.push(txt(`Candidate ${i + 1} — id: ${c.id}${c.summary ? ` — ${c.summary}` : ""}`));
    content.push(img(c.image));
  });
  content.push(txt(`Pick up to ${k} most similar candidate ids.`));
  const raw = await completeJson(rt, SELECT_SYSTEM, content, input.signal, "select_failed");
  const valid = new Set(input.candidates.map((c) => c.id));
  const selected = (raw as { selected?: unknown }).selected;
  if (!Array.isArray(selected)) {
    throw new RuntimeError("select_failed", "model output lacks selected[]", 502);
  }
  const out: string[] = [];
  for (const v of selected) {
    const id = asString(v);
    if (valid.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= k) break;
  }
  return out;
}

// --- grounding：文字目标 → 归一化 bbox（SDD 02 §7.2 `locate_roi`）---------------

const LOCATE_SYSTEM = [
  "You are a biomedical image agent locating a structure the user described.",
  "Coordinates use a normalized frame: (0,0) is the TOP-LEFT of the image and (1,1) the BOTTOM-RIGHT.",
  'Answer with ONE JSON object only: {"boxes": [{"box": [x0, y0, x1, y1], "confidence": 0..1, "why": string}]}',
  "- box: the tight bounding box of ONE instance, with x0 < x1 and y0 < y1, all within [0, 1].",
  "- confidence: how sure you are that this box contains the requested structure.",
  "- why: a few words on what makes you place it there.",
  "Return the boxes most-confident first. If the structure is not visible, or you would be guessing,",
  'return {"boxes": []} — an empty list is the correct answer, a fabricated box is not.',
].join("\n");

export interface LocatedBox {
  /** 图像像素坐标 [x0, y0, x1, y1]（已由归一化坐标乘回尺寸）。 */
  box: [number, number, number, number];
  confidence: number;
  why: string;
}

/**
 * 让视觉模型指出目标结构的位置。模型答归一化坐标，本函数按图像尺寸换算回像素——
 * 模型不知道图有多少像素，逼它输出像素坐标只会得到"1024 猜想"式的幻觉。
 *
 * 越界的框裁回图内；退化（零宽/零高）与非法数值直接丢弃，不做挽救：宁可少给一个框，
 * 也不能把坏几何交给 `propose_annotation`。
 */
export async function locateInImage(
  rt: VisionRuntime,
  input: {
    image: ImageInput;
    target: string;
    width: number;
    height: number;
    /** 参考案例（图谱先验）：先给模型看几张同类结构的示例再定位。 */
    references?: SelectCandidate[];
    maxBoxes?: number;
    signal?: AbortSignal;
  },
): Promise<LocatedBox[]> {
  const content: (TextContent | ImageContent)[] = [];
  for (const ref of input.references ?? []) {
    content.push(txt(`Reference example — ${ref.summary ?? ref.id}`));
    content.push(img(ref.image));
  }
  if (input.references?.length) {
    content.push(txt("Those were reference examples. Now the image to work on:"));
  }
  content.push(img(input.image));
  content.push(txt(`Locate: ${input.target}`));

  const raw = await completeJson(rt, LOCATE_SYSTEM, content, input.signal, "locate_failed");
  const boxes = (raw as { boxes?: unknown }).boxes;
  if (!Array.isArray(boxes)) {
    throw new RuntimeError("locate_failed", "model output lacks boxes[]", 502);
  }

  const out: LocatedBox[] = [];
  for (const entry of boxes) {
    const parsed = toPixelBox(entry, input.width, input.height);
    if (parsed) out.push(parsed);
    if (out.length >= (input.maxBoxes ?? 10)) break;
  }
  return out;
}

/** 归一化框 → 像素框；非法/退化返回 null。 */
function toPixelBox(entry: unknown, width: number, height: number): LocatedBox | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { box?: unknown; confidence?: unknown; why?: unknown };
  if (!Array.isArray(e.box) || e.box.length < 4) return null;
  const nums = e.box.slice(0, 4).map((v) => (typeof v === "number" ? v : Number(v)));
  if (nums.some((v) => !Number.isFinite(v))) return null;

  // 有的模型会直接答像素坐标——四个值都 > 1 时按像素理解，避免把整图当成一个框
  const looksNormalized = nums.every((v) => v >= 0 && v <= 1);
  const scaled = looksNormalized ? [nums[0]! * width, nums[1]! * height, nums[2]! * width, nums[3]! * height] : nums;

  const x0 = clamp(Math.min(scaled[0]!, scaled[2]!), 0, width);
  const x1 = clamp(Math.max(scaled[0]!, scaled[2]!), 0, width);
  const y0 = clamp(Math.min(scaled[1]!, scaled[3]!), 0, height);
  const y1 = clamp(Math.max(scaled[1]!, scaled[3]!), 0, height);
  if (!(x1 - x0 >= 1) || !(y1 - y0 >= 1)) return null; // 退化框丢弃

  const confidence = typeof e.confidence === "number" && Number.isFinite(e.confidence)
    ? clamp(e.confidence, 0, 1)
    : 0;
  return { box: [x0, y0, x1, y1], confidence, why: asString(e.why) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
