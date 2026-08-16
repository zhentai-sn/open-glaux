import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type AssistantMessage,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { RuntimeError } from "../../src/errors.js";
import {
  chooseAmongImages,
  describeImage,
  extractJson,
  normalizeDescription,
  type VisionRuntime,
} from "../../src/pi/vision.js";

// SDD 03 §7.6 描述生成 / §6.3 挑选步：用 faux provider 断言"图像块确实进了模型上下文"、
// JSON 宽松解析与一次重试、描述规整（固定字段 + extra 对象）。

const PNG = "iVBORw0KGgo="; // 任意 base64 占位

function makeRuntime(steps: AssistantMessage[]): {
  rt: VisionRuntime;
  contexts: Context[];
} {
  const contexts: Context[] = [];
  const faux = fauxProvider({ models: [{ id: "vlm", input: ["text", "image"] }] });
  faux.setResponses(
    steps.map((s) => (ctx: Context) => {
      contexts.push(ctx);
      return s;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  return { rt: { models, model: faux.getModel() }, contexts };
}

describe("extractJson / normalizeDescription", () => {
  it("strips fences and takes the outer object", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('noise {"a":{"b":2}} tail')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });

  it("fills missing fields, coerces findings, forces extra to object", () => {
    const d = normalizeDescription({
      modality: "TEM",
      findings: ["电子致密物", { name: "足突融合", location: "上皮侧" }, { nope: 1 }],
      extra: "not-an-object",
    });
    expect(d).toEqual({
      modality: "TEM",
      subject: "",
      findings: [{ name: "电子致密物" }, { name: "足突融合", location: "上皮侧" }],
      pattern: "",
      summary: "",
      extra: {},
    });
    expect(() => normalizeDescription([])).toThrow();
  });
});

describe("describeImage", () => {
  it("sends the image block + hint and returns a normalized description", async () => {
    const { rt, contexts } = makeRuntime([
      fauxAssistantMessage(
        '{"modality":"TEM","subject":"GBM","findings":[{"name":"EDD","location":"subepithelial","appearance":"dense"}],"pattern":"granular","summary":"subepithelial EDD along GBM","extra":{"magnification":"x8000"}}',
      ),
    ]);
    const d = await describeImage(rt, { image: { data: PNG }, hint: "标签：TEM, EDD" });
    expect(d.modality).toBe("TEM");
    expect(d.findings[0]).toEqual({ name: "EDD", location: "subepithelial", appearance: "dense" });
    expect(d.extra).toEqual({ magnification: "x8000" });
    const user = contexts[0]!.messages[0]!;
    expect(user.role).toBe("user");
    const blocks = user.content as { type: string; data?: string; text?: string; mimeType?: string }[];
    expect(blocks[0]).toEqual({ type: "image", data: PNG, mimeType: "image/png" });
    expect(blocks[1]!.text).toContain("标签：TEM, EDD");
    expect(contexts[0]!.systemPrompt).toContain("JSON");
  });

  it("retries once on invalid JSON then succeeds", async () => {
    const { rt, contexts } = makeRuntime([
      fauxAssistantMessage("Sure! Here is a description without json."),
      fauxAssistantMessage('{"modality":"US","subject":"carotid","findings":[],"pattern":"","summary":"s","extra":{}}'),
    ]);
    const d = await describeImage(rt, { image: { data: PNG } });
    expect(d.modality).toBe("US");
    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.messages).toHaveLength(2); // 追加了"只回 JSON"的提醒
  });

  it("fails with describe_failed after two invalid answers", async () => {
    const { rt } = makeRuntime([fauxAssistantMessage("nope"), fauxAssistantMessage("still nope")]);
    await expect(describeImage(rt, { image: { data: PNG } })).rejects.toMatchObject({
      code: "describe_failed",
      statusCode: 502,
    });
  });

  it("maps a provider error stop reason to describe_failed", async () => {
    const { rt } = makeRuntime([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "quota exceeded" }),
    ]);
    const err = await describeImage(rt, { image: { data: PNG } }).catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.message).toContain("quota");
  });
});

describe("chooseAmongImages", () => {
  const candidates = [
    { id: "a", image: { data: PNG }, summary: "sub-epithelial" },
    { id: "b", image: { data: PNG } },
    { id: "c", image: { data: PNG } },
    { id: "d", image: { data: PNG } },
  ];

  it("passes target + all candidates as image blocks and returns only valid ids in order, capped at k", async () => {
    const { rt, contexts } = makeRuntime([
      fauxAssistantMessage('{"selected":["c","zzz","a","b","d"]}'),
    ]);
    const picked = await chooseAmongImages(rt, { target: { data: PNG }, candidates, k: 3 });
    expect(picked).toEqual(["c", "a", "b"]);
    const blocks = contexts[0]!.messages[0]!.content as { type: string; text?: string }[];
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(5); // 1 目标 + 4 候选
    expect(blocks.some((b) => b.text?.includes("id: a") && b.text.includes("sub-epithelial"))).toBe(true);
  });

  it("returns [] for no candidates without calling the model", async () => {
    const { rt, contexts } = makeRuntime([]);
    expect(await chooseAmongImages(rt, { target: { data: PNG }, candidates: [] })).toEqual([]);
    expect(contexts).toHaveLength(0);
  });

  it("fails with select_failed when selected[] is missing", async () => {
    const { rt } = makeRuntime([fauxAssistantMessage('{"foo":1}'), fauxAssistantMessage('{"foo":1}')]);
    await expect(
      chooseAmongImages(rt, { target: { data: PNG }, candidates }),
    ).rejects.toMatchObject({ code: "select_failed" });
  });
});
