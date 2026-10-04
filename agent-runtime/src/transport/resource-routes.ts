/**
 * SDD 17 §7.5、§9.2：Skills、提示词模板、自定义说明的管理接口。只在 runtime（回环地址）上，不经 backend。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import { chatEdition } from "../edition.js";
import { RuntimeError } from "../errors.js";
import { toolCatalog } from "../plugins/registry.js";
import { projectDirOf } from "../permission/load.js";
import { readSettingsFile, userSettingsPath } from "../permission/settings.js";
import { loadResources } from "../resources/load.js";
import {
  deleteSkill,
  deleteTemplate,
  getInstructions,
  getSkill,
  getTemplate,
  putInstructions,
  putSkill,
  putTemplate,
  setSkillEnabled,
  type StoreContext,
} from "../resources/store.js";

export interface ResourceRouteDependencies {
  env?: NodeJS.ProcessEnv;
  builtinSkillsDir?: string;
  builtinAgentsDir?: string;
  /** project_id → 项目目录；缺省经 backend `GET /projects`。 */
  projectDir?: (projectId: string) => Promise<string | undefined>;
}

type Params = { source?: string; name?: string; scope?: string };

function contentOf(body: unknown): string {
  const content = (body as { content?: unknown } | null)?.content;
  if (typeof content !== "string") throw new RuntimeError("invalid_request", "content must be a string.", 400);
  return content;
}

export function registerResourceRoutes(server: FastifyInstance, deps: ResourceRouteDependencies = {}): void {
  const contextFor = async (request: FastifyRequest): Promise<StoreContext> => {
    const projectId = (request.query as { project_id?: unknown }).project_id;
    const projectDir = typeof projectId === "string" && projectId
      ? await (deps.projectDir ?? ((id: string) => projectDirOf(id)))(projectId)
      : undefined;
    return {
      ...(deps.env ? { env: deps.env } : {}),
      ...(deps.builtinSkillsDir ? { builtinSkillsDir: deps.builtinSkillsDir } : {}),
      ...(deps.builtinAgentsDir ? { builtinAgentsDir: deps.builtinAgentsDir } : {}),
      ...(projectDir ? { projectDir } : {}),
    };
  };
  const params = (request: FastifyRequest) => request.params as Params;

  server.get("/agent-api/v1/resources", async (request) => {
    const ctx = await contextFor(request);
    const disabled = (await readSettingsFile(userSettingsPath(ctx.env))).file?.skillsDisabled ?? [];
    const loaded = await loadResources({ ...ctx, disabledSkills: disabled });
    return {
      skills: loaded.skills,
      templates: loaded.templates,
      instructions: loaded.instructions,
      agents: loaded.agents,
      // SDD 19 §9.1：工具目录不依赖会话；chat 发行版不挂工具
      tools: chatEdition() ? [] : toolCatalog(),
      diagnostics: loaded.diagnostics,
    };
  });

  server.get("/agent-api/v1/skills/:source/:name", async (request) =>
    getSkill(params(request).source ?? "", params(request).name ?? "", await contextFor(request)));
  server.put("/agent-api/v1/skills/:source/:name", async (request) =>
    putSkill(params(request).source ?? "", params(request).name ?? "", contentOf(request.body), await contextFor(request)));
  server.delete("/agent-api/v1/skills/:source/:name", async (request, reply) => {
    await deleteSkill(params(request).source ?? "", params(request).name ?? "", await contextFor(request));
    return reply.status(204).send();
  });
  server.put("/agent-api/v1/skills-enabled/:name", async (request) => {
    const enabled = (request.body as { enabled?: unknown } | null)?.enabled;
    if (typeof enabled !== "boolean") throw new RuntimeError("invalid_request", "enabled must be a boolean.", 400);
    const name = params(request).name ?? "";
    await setSkillEnabled(name, enabled, await contextFor(request));
    return { name, enabled };
  });

  server.get("/agent-api/v1/prompts/:source/:name", async (request) =>
    getTemplate(params(request).source ?? "", params(request).name ?? "", await contextFor(request)));
  server.put("/agent-api/v1/prompts/:source/:name", async (request) =>
    putTemplate(params(request).source ?? "", params(request).name ?? "", contentOf(request.body), await contextFor(request)));
  server.delete("/agent-api/v1/prompts/:source/:name", async (request, reply) => {
    await deleteTemplate(params(request).source ?? "", params(request).name ?? "", await contextFor(request));
    return reply.status(204).send();
  });

  server.get("/agent-api/v1/instructions/:scope", async (request) =>
    getInstructions(params(request).scope ?? "", await contextFor(request)));
  server.put("/agent-api/v1/instructions/:scope", async (request) =>
    putInstructions(params(request).scope ?? "", contentOf(request.body), await contextFor(request)));
}
