/** SDD 17 §7.5、§9.2、§15.3：资源管理接口契约与系统提示词预览。 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
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

  it("previews exactly the system prompt a real command receives", async () => {
    const seen: string[] = [];
    const { fixture, server, close } = await setup([
      [], // 预览也会构造模型运行时，夹具按调用次数发放预设回复
      [(context) => { seen.push(context.systemPrompt ?? ""); return fauxAssistantMessage("ok"); }],
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
      expect(preview.json().prompt).toBe(seen[0]);
      expect(preview.json().prompt).toContain("<name>imt</name>");
      expect(preview.json().tools).toEqual(expect.arrayContaining(["read", "write", "edit"]));
    } finally { await close(); }
  });
});
