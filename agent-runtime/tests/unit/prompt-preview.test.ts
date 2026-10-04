/** SDD 19 §7.5、§9.2、§15.1：分段、未挂载原因、token 估算与工具目录。 */
import { tmpdir } from "node:os";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PLUGINS, toolCatalog } from "../../src/plugins/registry.js";
import {
  defaultToolFactory,
  joinSystemPrompt,
  systemPromptFor,
  systemPromptSegments,
  type HarnessToolContext,
} from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import { buildPreview, estimateTextTokens } from "../../src/pi/prompt-preview.js";
import type { PromptExtraPart } from "../../src/resources/load.js";
import { TEST_CONNECTION } from "../helpers/runtime-fixture.js";
import { FIXTURE_OBJECT_IDS, viewerOn } from "../helpers/viewer-fixture.js";

const runtime = {} as ModelRuntime;
const cwd = tmpdir();
const workspace = { cwd, execEnv: new NodeExecutionEnv({ cwd }) };
const squash = (text: string) => text.replace(/\s+/gu, "");

function preview(context: HarnessToolContext, extras: PromptExtraPart[] = []) {
  const tools = defaultToolFactory(context);
  const segments = systemPromptSegments(context.viewer, tools, context, undefined, extras);
  return buildPreview({ prompt: joinSystemPrompt(segments), segments, tools, context, mode: context.permissionMode ?? "controlled" });
}

afterEach(() => vi.unstubAllEnvs());

describe("system prompt segments", () => {
  const extras: PromptExtraPart[] = [
    { kind: "instructions", scope: "user", text: '<instructions scope="user">\nCite units.\n</instructions>' },
    { kind: "instructions", scope: "project", text: '<instructions scope="project">\nUse mm.\n</instructions>' },
    { kind: "skills", text: "<available_skills>…</available_skills>" },
  ];
  const cases: [string, HarnessToolContext, PromptExtraPart[]][] = [
    ["no extras, no focus", { permissionMode: "controlled", connection: TEST_CONNECTION }, []],
    ["instructions and skills", { permissionMode: "controlled", connection: TEST_CONNECTION, ...workspace }, extras],
    ["image focus", {
      permissionMode: "controlled", connection: { ...TEST_CONNECTION, vision: true }, runtime, projectId: "prj-1",
      viewer: viewerOn(FIXTURE_OBJECT_IDS.image),
    }, extras.slice(0, 1)],
  ];

  it.each(cases)("joins to the same prompt as before and covers it without gaps (%s)", (_name, context, parts) => {
    const tools = defaultToolFactory(context);
    const segments = systemPromptSegments(context.viewer, tools, context, undefined, parts);
    const prompt = joinSystemPrompt(segments);
    expect(prompt).toBe(systemPromptFor(context.viewer, tools, context, undefined, parts.map((part) => part.text).join("\n\n")));
    expect(squash(segments.map((segment) => segment.text).join(""))).toBe(squash(prompt));
    expect(segments[0]!.kind).toBe("base");
    expect(segments.at(-1)!.kind).toBe("viewer");
    expect(segments.every((segment) => segment.text)).toBe(true);
  });

  it("labels instruction scopes and plugin fragments", () => {
    const segments = systemPromptSegments(undefined, defaultToolFactory({ ...workspace, permissionMode: "autonomous" }), { ...workspace, permissionMode: "autonomous" }, undefined, extras);
    expect(segments.filter((segment) => segment.kind === "instructions").map((segment) => segment.scope)).toEqual(["user", "project"]);
    expect(segments.some((segment) => segment.kind === "plugin" && segment.plugin === "files")).toBe(true);
  });
});

describe("unmounted reasons", () => {
  const reasonOf = (context: HarnessToolContext, name: string) =>
    preview(context).unmounted.find((tool) => tool.name === name)?.reason;

  it("reports mode for exec tools in observe mode", () => {
    expect(reasonOf({ permissionMode: "observe", connection: TEST_CONNECTION, ...workspace }, "bash")).toBe("mode");
  });

  it("reports needs_project before the inactive project plugin", () => {
    expect(reasonOf({ permissionMode: "controlled", connection: TEST_CONNECTION }, "list_files")).toBe("needs_project");
  });

  it("reports needs_vision for tools that require an image-capable connection", () => {
    const result = preview({ permissionMode: "controlled", connection: TEST_CONNECTION, runtime, projectId: "prj-1" });
    expect(result.unmounted.find((tool) => tool.name === "open_file")?.reason).toBe("needs_vision");
  });

  it("reports plugin_inactive when the files plugin has no workspace", () => {
    expect(reasonOf({ permissionMode: "autonomous", connection: TEST_CONNECTION }, "read")).toBe("plugin_inactive");
  });

  it("never lists a mounted tool as unmounted", () => {
    const result = preview({ permissionMode: "autonomous", connection: { ...TEST_CONNECTION, vision: true }, runtime, projectId: "prj-1", ...workspace });
    const mounted = new Set(result.tools.map((tool) => tool.name));
    expect(result.unmounted.some((tool) => mounted.has(tool.name))).toBe(false);
  });
});

describe("preview payload", () => {
  it("exposes model-facing tool definitions and token estimates", () => {
    const result = preview({ permissionMode: "autonomous", connection: TEST_CONNECTION, ...workspace });
    const bash = result.tools.find((tool) => tool.name === "bash")!;
    expect(bash).toMatchObject({ plugin: "files", effect: "exec" });
    expect(bash.description.length).toBeGreaterThan(0);
    expect(bash.parameters).toBeTypeOf("object");
    expect(result.est_tokens.prompt).toBe(estimateTextTokens(result.prompt));
    expect(result.est_tokens.tools).toBe(result.tools.reduce((sum, tool) => sum + tool.est_tokens, 0));
    for (const value of [...result.segments.map((s) => s.est_tokens), ...result.tools.map((t) => t.est_tokens)]) {
      expect(Number.isInteger(value) && value >= 0).toBe(true);
    }
  });

  it("estimates text as ceil(chars / 4)", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});

describe("tool catalog", () => {
  it("lists every plugin tool in registry order with its declarations", () => {
    const catalog = toolCatalog();
    expect(catalog.map((tool) => tool.name)).toEqual(PLUGINS.flatMap((plugin) => (plugin.tools ?? []).map((tool) => tool.name)));
    expect(catalog.find((tool) => tool.name === "bash")).toEqual({ name: "bash", plugin: "files", effect: "exec", requires: [] });
    expect(catalog.find((tool) => tool.name === "open_file")).toEqual({ name: "open_file", plugin: "project", effect: "read", requires: ["project", "vision"] });
  });
});
