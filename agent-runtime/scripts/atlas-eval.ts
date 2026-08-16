/**
 * Atlas 价值验证脚本（SDD 03 D-17 / 计划 T7）：固定一组测试图 + 人工框，比较
 *   A) 无图谱：直接让 VLM 给目标 bbox；
 *   B) 有图谱：`selectExemplars`（检索 ≤10 → VLM 挑 1–3 张）后 few-shot 给 bbox；
 * 输出每张图两种方式的 IoU 及均值/中位数。**不设通过阈值**——只交付数字，02 `locate_roi` 落地后复跑。
 *
 * 用法（agent-runtime 目录）：
 *   GLAUX_VLM_PROVIDER=openai-compatible GLAUX_VLM_MODEL=qwen2.5-vl GLAUX_VLM_BASE_URL=http://localhost:11434/v1 \
 *   [GLAUX_VLM_API_KEY=…] [GLAUX_VLM_CONTEXT_WINDOW=32768 GLAUX_VLM_MAX_TOKENS=1024] [GLAUX_BACKEND_URL=http://127.0.0.1:8000] \
 *   npx tsx scripts/atlas-eval.ts --manifest ../eval/tem-edd.json [--out result.json] [--k 3] [--limit 10]
 *
 * manifest JSON：
 *   {
 *     "query": "subepithelial electron dense deposits along GBM",   // 给 VLM 的目标描述（可被单项覆盖）
 *     "tags": ["TEM", "EDD"],                                          // 检索标签（可被单项覆盖）
 *     "items": [ { "image": "img/001.png", "gt": [x0, y0, x1, y1], "query"?: "…", "tags"?: [...] }, … ]
 *   }
 * `image` 相对 manifest 所在目录；只支持 PNG（尺寸从 IHDR 读取，用于提示词）。
 *
 * 凭据只在本进程内存里，直接进 runtime 的 createModelRuntime，不经 backend。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AtlasClient, egressFor } from "../src/atlas/client.js";
import { selectExemplars, type SelectedExemplar } from "../src/atlas/select.js";
import type { ConnectionInput } from "../src/contracts.js";
import { createModelRuntime } from "../src/pi/model-runtime.js";
import { completeJson, type ImageInput, type VisionRuntime } from "../src/pi/vision.js";

type Box = [number, number, number, number];

interface ManifestItem {
  image: string;
  gt: Box;
  query?: string;
  tags?: string[];
}
interface Manifest {
  query?: string;
  tags?: string[];
  items: ManifestItem[];
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function pngSize(buf: Buffer): { w: number; h: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") throw new Error("only PNG is supported");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function connectionFromEnv(): ConnectionInput {
  const provider = process.env.GLAUX_VLM_PROVIDER === "anthropic" ? "anthropic" : "openai-compatible";
  const model = process.env.GLAUX_VLM_MODEL;
  if (!model) throw new Error("GLAUX_VLM_MODEL is required");
  const cw = Number(process.env.GLAUX_VLM_CONTEXT_WINDOW ?? "");
  const mt = Number(process.env.GLAUX_VLM_MAX_TOKENS ?? "");
  return {
    provider,
    model,
    vision: true,
    ...(process.env.GLAUX_VLM_BASE_URL ? { base_url: process.env.GLAUX_VLM_BASE_URL } : {}),
    ...(process.env.GLAUX_VLM_API_KEY ? { credential: process.env.GLAUX_VLM_API_KEY } : {}),
    ...(cw > 0 ? { context_window: cw } : {}),
    ...(mt > 0 ? { max_tokens: mt } : {}),
  };
}

const LOCATE_SYSTEM = [
  "You locate a described structure in a biomedical image.",
  "Reply with a single JSON object only: {\"bbox\": [x0, y0, x1, y1]} in integer pixel coordinates of the TARGET image",
  "(origin top-left, x0<x1, y0<y1). If exemplar images are given, use them as reference for what the structure looks like;",
  "the bbox must still be in the target image's coordinates. Do not add prose.",
].join(" ");

async function locateBbox(
  rt: VisionRuntime,
  target: ImageInput,
  size: { w: number; h: number },
  query: string,
  exemplars: SelectedExemplar[],
): Promise<Box | null> {
  const content: Parameters<typeof completeJson>[2] = [];
  exemplars.forEach((e, i) => {
    const summary = (e.description as { summary?: string } | null)?.summary ?? "";
    content.push({ type: "image", data: e.crop_base64, mimeType: "image/png" });
    content.push({
      type: "text",
      text: `Exemplar ${i + 1} (crop of the structure): ${[e.caption, summary].filter(Boolean).join(" · ") || e.tags_raw.join(", ")}`,
    });
  });
  content.push({ type: "image", data: target.data, mimeType: target.mimeType ?? "image/png" });
  content.push({ type: "text", text: `TARGET image (${size.w}x${size.h} px). Locate: ${query}` });
  const raw = (await completeJson(rt, LOCATE_SYSTEM, content, undefined, "locate_failed")) as { bbox?: unknown };
  const b = raw?.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = b as number[];
  return [
    Math.max(0, Math.min(size.w, Math.round(Math.min(x0!, x1!)))),
    Math.max(0, Math.min(size.h, Math.round(Math.min(y0!, y1!)))),
    Math.max(0, Math.min(size.w, Math.round(Math.max(x0!, x1!)))),
    Math.max(0, Math.min(size.h, Math.round(Math.max(y0!, y1!)))),
  ];
}

async function main(): Promise<void> {
  const manifestPath = arg("manifest");
  if (!manifestPath) throw new Error("--manifest <file.json> is required");
  const k = Number(arg("k", "3"));
  const limit = Number(arg("limit", "10"));
  const out = arg("out");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const base = dirname(resolve(manifestPath));

  const connection = connectionFromEnv();
  const rt = createModelRuntime(connection);
  const egress = await egressFor(connection);
  const client = new AtlasClient();
  console.log(`model=${connection.provider}/${connection.model} egress=${egress} items=${manifest.items.length}`);

  const rows: {
    image: string;
    gt: Box;
    plain: Box | null;
    atlas: Box | null;
    iou_plain: number;
    iou_atlas: number;
    candidates: number;
    selected: string[];
    excluded_by_egress: number;
    error?: string;
  }[] = [];

  try {
    for (const item of manifest.items) {
      const buf = readFileSync(resolve(base, item.image));
      const size = pngSize(buf);
      const target: ImageInput = { data: buf.toString("base64"), mimeType: "image/png" };
      const query = item.query ?? manifest.query ?? "the target structure";
      const tags = item.tags ?? manifest.tags ?? [];
      const row: (typeof rows)[number] = {
        image: item.image,
        gt: item.gt,
        plain: null,
        atlas: null,
        iou_plain: 0,
        iou_atlas: 0,
        candidates: 0,
        selected: [],
        excluded_by_egress: 0,
      };
      try {
        row.plain = await locateBbox(rt, target, size, query, []);
        row.iou_plain = row.plain ? iou(row.plain, item.gt) : 0;
        const sel = await selectExemplars(rt, client, {
          tags,
          q: query,
          egress,
          target,
          traceId: `atlas-eval:${item.image}`,
          k,
          limit,
        });
        row.candidates = sel.candidates.length;
        row.selected = sel.selected.map((s) => s.exemplar_id);
        row.excluded_by_egress = sel.excluded_by_egress;
        row.atlas = await locateBbox(rt, target, size, query, sel.selected);
        row.iou_atlas = row.atlas ? iou(row.atlas, item.gt) : 0;
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      rows.push(row);
      console.log(
        `${item.image}\tplain=${row.iou_plain.toFixed(3)}\tatlas=${row.iou_atlas.toFixed(3)}\tcand=${row.candidates}\tsel=${row.selected.length}\texcl=${row.excluded_by_egress}${row.error ? `\tERR ${row.error}` : ""}`,
      );
    }
  } finally {
    rt.disposeCredential();
  }

  const ok = rows.filter((r) => !r.error);
  const summary = {
    n: rows.length,
    n_ok: ok.length,
    iou_plain_mean: ok.reduce((s, r) => s + r.iou_plain, 0) / Math.max(1, ok.length),
    iou_atlas_mean: ok.reduce((s, r) => s + r.iou_atlas, 0) / Math.max(1, ok.length),
    iou_plain_median: median(ok.map((r) => r.iou_plain)),
    iou_atlas_median: median(ok.map((r) => r.iou_atlas)),
    egress,
    model: `${connection.provider}/${connection.model}`,
  };
  console.log("\nsummary:", JSON.stringify(summary, null, 2));
  if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
