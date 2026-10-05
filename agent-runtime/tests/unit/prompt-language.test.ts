/** SDD 20 §15.1：系统提示词与工具定义随语言切换；英文与实施前逐字一致。 */
import { tmpdir } from "node:os";

import { formatSkillsForSystemPrompt, type Skill } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localizeSchema, schemaDescriptionPaths } from "../../src/i18n/prompt-lang.js";
import { InteractionTable } from "../../src/interaction/table.js";
import { commandDigest } from "../../src/pi/command-service.js";
import { defaultToolFactory, systemPromptFor, type HarnessTool, type HarnessToolContext } from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import type { VideoTurn } from "../../src/pi/video-turn.js";
import { formatSkillsCatalog } from "../../src/resources/load.js";
import { TEST_CONNECTION } from "../helpers/runtime-fixture.js";
import { FIXTURE_OBJECT_IDS, viewerOn } from "../helpers/viewer-fixture.js";

const runtime = {} as ModelRuntime;
const videoTurn = {} as VideoTurn;
const cwd = tmpdir();
const workspace = { cwd, execEnv: new NodeExecutionEnv({ cwd }) };
const CJK = /[一-鿿]/u;
/** 中文提示词里不应出现的英文指令词；机器字段（object_id= 等）与工具名不含这些词。 */
const ENGLISH_INSTRUCTION = /\b(the|you|your|and|with|when|never|before|use|call)\b/iu;

function prompt(context: HarnessToolContext, video?: { duration_ms: number; has_audio: boolean }): string {
  return systemPromptFor(context.viewer, defaultToolFactory(context), context, video);
}

/** 三种场景与 system-prompt.test.ts 的快照场景相同。 */
const SCENES: [string, HarnessToolContext, { duration_ms: number; has_audio: boolean }?][] = [
  ["no focus, text-only connection", { permissionMode: "controlled", connection: TEST_CONNECTION }],
  ["image focus, vision connection, project bound, segmentation enabled", {
    permissionMode: "controlled",
    connection: { ...TEST_CONNECTION, vision: true },
    runtime,
    projectId: "prj-00000000",
    viewer: viewerOn(FIXTURE_OBJECT_IDS.image, { task: "far_wall_cca_imt", collection: "cubs" }),
  }],
  ["video focus with joint audio-video turn", {
    permissionMode: "controlled",
    connection: { ...TEST_CONNECTION, vision: true, media_adapter: "qwen-omni" },
    runtime,
    videoTurn,
    viewer: viewerOn(FIXTURE_OBJECT_IDS.video, { index: { t: 12 } }),
  }, { duration_ms: 90_000, has_audio: true }],
];

function enableSegmentation(): void {
  vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
  vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-only");
}

/** 挂满 16 个工具的上下文。 */
function fullContext(lang?: "en" | "zh"): HarnessToolContext {
  return {
    permissionMode: "autonomous",
    connection: { ...TEST_CONNECTION, vision: true },
    runtime,
    videoTurn,
    projectId: "prj-1",
    ...workspace,
    interactions: new InteractionTable({ emit: () => {} }),
    run: { sessionId: "s", commandId: "c" },
    agents: [{ name: "general", description: "General helper.", body: "", max_turns: 20 } as never],
    spawnSubagent: async () => ({}) as never,
    viewer: viewerOn(FIXTURE_OBJECT_IDS.video),
    ...(lang ? { lang } : {}),
  };
}

/** 去掉所有 description 后的 schema，用于比较结构。 */
function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "description")
      .map(([key, child]) => [key, withoutDescriptions(child)]));
  }
  return value;
}

afterEach(() => vi.unstubAllEnvs());

describe("system prompt language", () => {
  it.each(SCENES)("English is the default and unchanged (%s)", (_name, context, video) => {
    enableSegmentation();
    expect(prompt({ ...context, lang: "en" }, video)).toBe(prompt(context, video));
  });

  it.each(SCENES)("Chinese prompt (%s)", (_name, context, video) => {
    enableSegmentation();
    const zh = prompt({ ...context, lang: "zh" }, video);
    expect(zh).toMatch(CJK);
    expect(zh).not.toMatch(ENGLISH_INSTRUCTION);
    expect(zh).toMatchSnapshot();
  });

  it("keeps machine fields in the Chinese viewer context", () => {
    const zh = prompt({ ...SCENES[1]![1], lang: "zh" });
    expect(zh).toContain(`object_id=${FIXTURE_OBJECT_IDS.image}`);
    expect(zh).toContain("task=far_wall_cca_imt");
    expect(zh).toContain("查看器上下文（");
  });

  it("localizes the files and sub-agent fragments", () => {
    const { viewer: _viewer, ...context } = fullContext("zh");
    const zh = prompt(context);
    expect(zh).toContain("你可以用 read、write、edit 读取和修改文件");
    expect(zh).toContain("可用的子智能体：general（General helper.）。");
    expect(zh).not.toMatch(ENGLISH_INSTRUCTION);
  });
});

describe("tool definition language", () => {
  const byName = (tools: HarnessTool[]) => new Map(tools.map((tool) => [tool.name, tool]));

  it("mounts all 17 tools in the full context", () => {
    enableSegmentation();
    expect(defaultToolFactory(fullContext("zh"))).toHaveLength(17);
  });

  it("translates every tool description and parameter description", () => {
    enableSegmentation();
    for (const tool of defaultToolFactory(fullContext("zh"))) {
      expect(tool.description, tool.name).toMatch(CJK);
      for (const path of schemaDescriptionPaths(tool.parameters)) {
        const node = path.split(/\.|(?=\[\])|(?=\|)/u).reduce<Record<string, unknown>>((acc, key) => {
          if (key === "[]") return acc.items as Record<string, unknown>;
          if (key.startsWith("|")) return (acc.anyOf as Record<string, unknown>[])[Number(key.slice(1))]!;
          return (acc.properties as Record<string, Record<string, unknown>>)[key]!;
        }, tool.parameters as unknown as Record<string, unknown>);
        expect(node.description, `${tool.name}.${path}`).toMatch(CJK);
      }
    }
  });

  it("keeps parameter schemas identical apart from descriptions, and English unchanged", () => {
    enableSegmentation();
    const en = byName(defaultToolFactory(fullContext()));
    const explicitEn = byName(defaultToolFactory(fullContext("en")));
    for (const tool of defaultToolFactory(fullContext("zh"))) {
      const source = en.get(tool.name)!;
      expect(explicitEn.get(tool.name)!.description).toBe(source.description);
      expect(withoutDescriptions(tool.parameters), tool.name).toEqual(withoutDescriptions(source.parameters));
      expect(Object.getOwnPropertySymbols(tool.parameters)).toEqual(Object.getOwnPropertySymbols(source.parameters));
    }
  });

  it("validates pi built-in tool arguments the same way after localization", () => {
    const en = byName(defaultToolFactory({ ...workspace, permissionMode: "autonomous" }));
    const zh = byName(defaultToolFactory({ ...workspace, permissionMode: "autonomous", lang: "zh" }));
    const cases: [string, Record<string, unknown>][] = [
      ["edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] }],
      ["edit", { path: "a.txt", edits: [{ oldText: 1 }] }],
      ["read", { path: "a.txt", offset: 2 }],
      ["read", { offset: "x" }],
      ["bash", { command: "ls", timeout: 5 }],
      ["write", { path: "a.txt" }],
    ];
    const outcome = (tool: HarnessTool, args: Record<string, unknown>) => {
      try {
        return { ok: validateToolArguments(tool as never, { type: "toolCall", id: "t", name: tool.name, arguments: args } as never) };
      } catch {
        return { ok: "invalid" };
      }
    };
    for (const [name, args] of cases) {
      expect(outcome(zh.get(name)!, args), `${name} ${JSON.stringify(args)}`).toEqual(outcome(en.get(name)!, args));
    }
  });

  it("rejects missing or unknown translations", () => {
    const schema = { type: "object", properties: { a: { type: "string", description: "A" } } };
    expect(() => localizeSchema(schema, {})).toThrow(/Missing translated description/u);
    expect(() => localizeSchema(schema, { a: "甲", b: "乙" })).toThrow(/unknown schema paths/u);
  });
});

describe("skills catalog language", () => {
  const skills = [
    { name: "imt", description: "Carotid <IMT> & co.", filePath: "/s/imt/SKILL.md", disableModelInvocation: false },
    { name: "manual", description: "Hidden", filePath: "/s/manual/SKILL.md", disableModelInvocation: true },
  ] as unknown as Skill[];

  it("uses pi's English catalog verbatim", () => {
    expect(formatSkillsCatalog(skills, "en")).toBe(formatSkillsForSystemPrompt(skills));
  });

  it("keeps the XML block and replaces only the introduction in Chinese", () => {
    const xml = (text: string) => text.slice(text.indexOf("<available_skills>"));
    const zh = formatSkillsCatalog(skills, "zh");
    expect(xml(zh)).toBe(xml(formatSkillsForSystemPrompt(skills)));
    expect(zh.slice(0, zh.indexOf("<available_skills>"))).toMatch(CJK);
    expect(formatSkillsCatalog([skills[1]!], "zh")).toBe("");
  });
});

describe("command digest", () => {
  it("includes lang only when present", () => {
    const base = { command_id: "c", type: "prompt" as const, content: "hi", connection: TEST_CONNECTION };
    expect(commandDigest({ ...base, lang: "zh" })).not.toBe(commandDigest(base));
    expect(commandDigest({ ...base, lang: "en" })).not.toBe(commandDigest({ ...base, lang: "zh" }));
  });
});
