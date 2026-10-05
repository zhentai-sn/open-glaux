/** SDD 17 §7.5、§9.2、§15.3，SDD 19 §9：资源管理接口契约、工具目录与系统提示词预览。 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { toolCatalog } from "../../src/plugins/registry.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import { loadResources } from "../../src/resources/load.js";
import { buildServer } from "../../src/transport/server.js";
import { TEST_CONNECTION, createRuntimeFixture } from "../helpers/runtime-fixture.js";

const VALID = "---\nname: imt\ndescription: Carotid IMT protocol.\n---\n\nMeasure the far wall.\n";
const exists = (path: string) => access(path).then(() => true, () => false);

let root: string;
let home: string;
let builtin: string;
let project: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "glaux-resapi-"));
  home = join(root, "home");
  builtin = join(root, "builtin");
  project = join(root, "project");
  await mkdir(join(builtin, "base"), { recursive: true });
  await writeFile(join(builtin, "base", "SKILL.md"), "---\nname: base\ndescription: Built-in.\n---\nBase.\n");
  await mkdir(project, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function setup(batches: Parameters<typeof createRuntimeFixture>[0] = []) {
  const env = { GLAUX_HOME: home };
  const fixture = await createRuntimeFixture(batches, {
    toolFactory: defaultToolFactory,
    permission: {
      loadSettings: async () => ({ settings: EMPTY_SETTINGS, alwaysPath: join(root, "unused.json"), projectDir: project }),
      loadResources: (options) => loadResources({ ...options, env, builtinSkillsDir: builtin }),
    },
  });
  const server = buildServer({
    routes: {
      sessions: fixture.sessions, commands: fixture.commands, registry: fixture.registry, broker: fixture.broker,
      resources: { env, builtinSkillsDir: builtin, projectDir: async (id) => (id === "prj-a" ? project : undefined) },
    },
  });
  return { fixture, server, close: async () => { await server.close(); await fixture.close(); } };
}

describe("resource management API", () => {
  it("creates, reads, lists, validates and deletes skills", async () => {
    const { server, close } = await setup();
    try {
      const put = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/imt", payload: { content: VALID } });
      expect(put.statusCode).toBe(200);
      expect(put.json().item).toMatchObject({ name: "imt", source: "user", enabled: true, model_invocable: true });
      expect((await server.inject({ method: "GET", url: "/agent-api/v1/skills/user/imt" })).json()).toMatchObject({ content: VALID, editable: true });

      const list = (await server.inject({ method: "GET", url: "/agent-api/v1/resources" })).json();
      expect(list.skills.map((s: { name: string; source: string }) => `${s.source}:${s.name}`).sort()).toEqual(["builtin:base", "user:imt"]);

      const invalid = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/imt", payload: { content: "---\nname: imt\n---\nno description" } });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error.code).toBe("invalid_skill");
      expect(await readFile(join(home, "skills", "imt", "SKILL.md"), "utf8")).toBe(VALID);

      const fresh = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/other", payload: { content: "no frontmatter" } });
      expect(fresh.statusCode).toBe(422);
      expect(await exists(join(home, "skills", "other"))).toBe(false);

      expect((await server.inject({ method: "DELETE", url: "/agent-api/v1/skills/user/imt" })).statusCode).toBe(204);
      expect((await server.inject({ method: "DELETE", url: "/agent-api/v1/skills/user/imt" })).statusCode).toBe(404);
    } finally { await close(); }
  });

  it("guards names, built-in sources and project scope", async () => {
    const { server, close } = await setup();
    try {
      const bad = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/Bad_Name", payload: { content: VALID } });
      expect(bad.json().error.code).toBe("invalid_name");
      const readOnly = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/builtin/base", payload: { content: VALID } });
      expect(readOnly.statusCode).toBe(403);
      expect((await server.inject({ method: "GET", url: "/agent-api/v1/skills/builtin/base" })).json()).toMatchObject({ editable: false });
      const noProject = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/project/imt", payload: { content: VALID } });
      expect(noProject.json().error.code).toBe("project_not_found");
      const inProject = await server.inject({ method: "PUT", url: "/agent-api/v1/skills/project/imt?project_id=prj-a", payload: { content: VALID } });
      expect(inProject.statusCode).toBe(200);
      expect(await exists(join(project, ".glaux", "skills", "imt", "SKILL.md"))).toBe(true);
    } finally { await close(); }
  });

  it("toggles skills in the user settings while keeping other fields", async () => {
    const { server, close } = await setup();
    try {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "settings.json"), JSON.stringify({ budget: { max_turns: 10 } }));
      await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/imt", payload: { content: VALID } });
      expect((await server.inject({ method: "PUT", url: "/agent-api/v1/skills-enabled/imt", payload: { enabled: false } })).json()).toEqual({ name: "imt", enabled: false });
      expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8"))).toEqual({ budget: { max_turns: 10 }, skills: { disabled: ["imt"] } });
      const list = (await server.inject({ method: "GET", url: "/agent-api/v1/resources" })).json();
      expect(list.skills.find((s: { name: string }) => s.name === "imt").enabled).toBe(false);
      await server.inject({ method: "PUT", url: "/agent-api/v1/skills-enabled/imt", payload: { enabled: true } });
      expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8")).skills.disabled).toEqual([]);
    } finally { await close(); }
  });

  it("manages templates and instructions", async () => {
    const { server, close } = await setup();
    try {
      expect((await server.inject({ method: "PUT", url: "/agent-api/v1/prompts/user/review", payload: { content: "Review $1" } })).statusCode).toBe(200);
      expect((await server.inject({ method: "GET", url: "/agent-api/v1/prompts/user/review" })).json().content).toBe("Review $1");
      expect((await server.inject({ method: "DELETE", url: "/agent-api/v1/prompts/user/review" })).statusCode).toBe(204);

      expect((await server.inject({ method: "GET", url: "/agent-api/v1/instructions/user" })).json()).toMatchObject({ content: "" });
      const saved = await server.inject({ method: "PUT", url: "/agent-api/v1/instructions/project?project_id=prj-a", payload: { content: "Use mm." } });
      expect(saved.json()).toMatchObject({ scope: "project", exists: true, bytes: 7 });
      expect(await readFile(join(project, "GLAUX.md"), "utf8")).toBe("Use mm.");
      await server.inject({ method: "PUT", url: "/agent-api/v1/instructions/project?project_id=prj-a", payload: { content: "  " } });
      expect(await exists(join(project, "GLAUX.md"))).toBe(false);
    } finally { await close(); }
  });

  it("lists the static tool catalog with resources (SDD 19 §9.1)", async () => {
    const { server, close } = await setup();
    try {
      const list = (await server.inject({ method: "GET", url: "/agent-api/v1/resources" })).json();
      expect(list.tools).toEqual(toolCatalog());
      expect(list.tools.find((tool: { name: string }) => tool.name === "write")).toEqual({ name: "write", plugin: "files", effect: "write", requires: [] });
    } finally { await close(); }
  });

  it("previews exactly the system prompt a real command receives", async () => {
    const seen: { prompt: string; tools: { name: string; description: string; parameters: unknown }[] }[] = [];
    const { fixture, server, close } = await setup([
      [], // 预览也会构造模型运行时，夹具按调用次数发放预设回复
      [(context) => {
        seen.push({
          prompt: context.systemPrompt ?? "",
          tools: (context.tools ?? []).map(({ name, description, parameters }) => ({ name, description, parameters })),
        });
        return fauxAssistantMessage("ok");
      }],
    ]);
    try {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "GLAUX.md"), "Cite units.");
      await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/imt", payload: { content: VALID } });
      const sessionId = crypto.randomUUID();
      await fixture.sessions.createSession({ session_id: sessionId, project_id: "prj-a" });
      const preview = await server.inject({ method: "POST", url: `/agent-api/v1/sessions/${sessionId}/system-prompt`, payload: { connection: TEST_CONNECTION } });
      expect(preview.statusCode).toBe(200);
      await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "hi", connection: TEST_CONNECTION });
      await fixture.registry.waitForIdle(sessionId);
      const body = preview.json();
      expect(body.prompt).toBe(seen[0]!.prompt);
      expect(body.prompt).toContain("<name>imt</name>");
      expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["read", "write", "edit"]));
      // SDD 19 §15.1：工具定义与真实命令挂载的一致；分段覆盖 prompt
      expect(body.tools.map(({ name, description, parameters }: { name: string; description: string; parameters: unknown }) =>
        ({ name, description, parameters }))).toEqual(JSON.parse(JSON.stringify(seen[0]!.tools)));
      expect(body.segments.map((segment: { kind: string; scope?: string }) => segment.scope ? `${segment.kind}:${segment.scope}` : segment.kind))
        .toEqual(expect.arrayContaining(["base", "instructions:user", "skills", "viewer"]));
      const squash = (text: string) => text.replace(/\s+/gu, "");
      expect(squash(body.segments.map((segment: { text: string }) => segment.text).join(""))).toBe(squash(body.prompt));
      expect(body.unmounted.find((tool: { name: string }) => tool.name === "bash")).toBeUndefined();
    } finally { await close(); }
  });

  it("previews the Chinese prompt a real command with lang zh receives (SDD 20 §15.1)", async () => {
    const seen: { prompt: string; tools: { name: string; description: string; parameters: unknown }[] }[] = [];
    const { fixture, server, close } = await setup([
      [],
      [(context) => {
        seen.push({
          prompt: context.systemPrompt ?? "",
          tools: (context.tools ?? []).map(({ name, description, parameters }) => ({ name, description, parameters })),
        });
        return fauxAssistantMessage("好");
      }],
    ]);
    try {
      await server.inject({ method: "PUT", url: "/agent-api/v1/skills/user/imt", payload: { content: VALID } });
      const sessionId = crypto.randomUUID();
      await fixture.sessions.createSession({ session_id: sessionId, project_id: "prj-a" });
      const preview = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/system-prompt`, payload: { connection: TEST_CONNECTION, lang: "zh" },
      });
      expect(preview.statusCode).toBe(200);
      const commandId = crypto.randomUUID();
      const accepted = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/commands`,
        payload: { command_id: commandId, type: "prompt", content: "你好", connection: TEST_CONNECTION, lang: "zh" },
      });
      expect(accepted.statusCode).toBe(202);
      await fixture.registry.waitForIdle(sessionId);
      const body = preview.json();
      expect(body.prompt).toBe(seen[0]!.prompt);
      expect(body.prompt).toContain("你是 Glaux 内置的参考助手");
      expect(body.prompt).toContain("以下 Skill 为特定任务提供专门的说明。");
      expect(body.tools.map(({ name, description, parameters }: { name: string; description: string; parameters: unknown }) =>
        ({ name, description, parameters }))).toEqual(JSON.parse(JSON.stringify(seen[0]!.tools)));
      expect(body.tools.find((tool: { name: string }) => tool.name === "read").description).toMatch(/^读取文件内容/u);

      // §10：同一 command_id 换语言判为冲突
      const conflict = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/commands`,
        payload: { command_id: commandId, type: "prompt", content: "你好", connection: TEST_CONNECTION, lang: "en" },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe("idempotency_conflict");
    } finally { await close(); }
  });

  it("rejects an unsupported lang on commands and previews (SDD 20 §7.1 规则 2)", async () => {
    const { fixture, server, close } = await setup();
    try {
      const sessionId = crypto.randomUUID();
      await fixture.sessions.createSession({ session_id: sessionId });
      const command = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/commands`,
        payload: { command_id: crypto.randomUUID(), type: "prompt", content: "hi", connection: TEST_CONNECTION, lang: "fr" },
      });
      expect(command.statusCode).toBe(400);
      const regenerate = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/commands`,
        payload: { command_id: crypto.randomUUID(), type: "regenerate", connection: TEST_CONNECTION, lang: "zh-CN" },
      });
      expect(regenerate.statusCode).toBe(400);
      const preview = await server.inject({
        method: "POST", url: `/agent-api/v1/sessions/${sessionId}/system-prompt`, payload: { connection: TEST_CONNECTION, lang: 1 },
      });
      expect(preview.statusCode).toBe(400);
      expect(preview.json().error.code).toBe("invalid_request");
    } finally { await close(); }
  });
});
