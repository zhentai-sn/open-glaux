/**
 * SDD 00 §4（2026-10-28 修订）：视觉能力以提供商 `/models` 自报为第一权威，
 * 本地模型目录与名称启发式只作兜底。
 */
import { describe, expect, it } from "vitest";

import {
  modelMetaFromEntry,
  nameVision,
  visionFromEntry,
} from "../../src/pi/connection-probe.js";

describe("visionFromEntry（提供商自报）", () => {
  it("读 OpenRouter 的 architecture.input_modalities", () => {
    expect(visionFromEntry({ architecture: { input_modalities: ["text", "image"] } })).toBe("yes");
    expect(visionFromEntry({ architecture: { input_modalities: ["text"] } })).toBe("no");
  });

  it("读 architecture.modality 字符串", () => {
    expect(visionFromEntry({ architecture: { modality: "text+image->text" } })).toBe("yes");
    expect(visionFromEntry({ architecture: { modality: "text->text" } })).toBe("no");
  });

  it("读顶层 input_modalities", () => {
    expect(visionFromEntry({ input_modalities: ["text", "image"] })).toBe("yes");
  });

  it("读显式布尔字段", () => {
    expect(visionFromEntry({ supports_vision: true })).toBe("yes");
    expect(visionFromEntry({ supports_vision: false })).toBe("no");
    expect(visionFromEntry({ vision: true })).toBe("yes");
  });

  it("读 capabilities 数组", () => {
    expect(visionFromEntry({ capabilities: ["text", "vision"] })).toBe("yes");
    expect(visionFromEntry({ capabilities: ["text"] })).toBe("no");
  });

  it("读 LM Studio 风格的 type", () => {
    expect(visionFromEntry({ type: "vlm" })).toBe("yes");
  });

  it("什么都没声明时返回 undefined，交调用方兜底", () => {
    expect(visionFromEntry({ id: "deepseek-v4.1-flash", object: "model" })).toBeUndefined();
  });

  it("经 modelMetaFromEntry 透出", () => {
    expect(modelMetaFromEntry({ vision: true }).vision).toBe("yes");
    expect(modelMetaFromEntry({ id: "x" }).vision).toBeUndefined();
  });
});

describe("nameVision（本地兜底）", () => {
  it("deepseek-v4.1 系列按视觉处理（提供商目录尚未收录）", () => {
    expect(nameVision("deepseek-v4.1-flash")).toBe("yes");
  });

  it("纯文本型号保持 unknown，不据名判 no", () => {
    expect(nameVision("deepseek-chat")).toBe("unknown");
  });

  it("常见视觉记号仍命中", () => {
    expect(nameVision("qwen2.5-vl-7b")).toBe("yes");
    expect(nameVision("gpt-4o")).toBe("yes");
  });
});
