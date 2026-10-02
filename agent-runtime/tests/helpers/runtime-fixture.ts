import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxProvider,
  type FauxProviderHandle,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";

import type { ConnectionInput } from "../../src/contracts.js";
import { CommandService } from "../../src/pi/command-service.js";
import {
  HarnessRegistry,
  type HarnessToolFactory,
} from "../../src/pi/harness-registry.js";
import type { PermissionDeps } from "../../src/permission/plugin.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { loadResources } from "../../src/resources/load.js";
import { SessionService } from "../../src/pi/session-service.js";
import { SseBroker } from "../../src/transport/sse-broker.js";

export const TEST_CONNECTION: ConnectionInput = {
  provider: "openai-compatible",
  model: "fixture-model",
  base_url: "http://127.0.0.1:1234/v1",
  context_window: 128_000,
  max_tokens: 4096,
  credential: "fixture-credential",
};

export async function createRuntimeFixture(
  responseBatches: FauxResponseStep[][] = [],
  options: {
    contextWindow?: number;
    tokensPerSecond?: number;
    /** 缺省无工具（测试不触 backend）；需要时注入。 */
    toolFactory?: HarnessToolFactory;
    /** 交互请求超时；测试过期路径时调短。 */
    interactionTimeoutMs?: number;
    /** 权限依赖；缺省越界判定一律放行、无设置文件，测试不触 backend 与用户目录。 */
    permission?: PermissionDeps;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "glaux-runtime-fixture-"));
  let registry: HarnessRegistry | undefined;
  const sessions = new SessionService({
    workspaceDir: dataDir,
    piDatabasePath: join(dataDir, "pi-sessions.sqlite"),
    metaDatabasePath: join(dataDir, "glaux-meta.sqlite"),
    phaseForSession: (sessionId) => registry?.getPhase(sessionId) ?? "idle",
    pendingInteractions: (sessionId) => registry?.interactions.pending(sessionId) ?? [],
    warningsFor: (sessionId) => registry?.warningsFor(sessionId) ?? [],
    workspacesRoot: join(dataDir, "workspaces"),
  });
  await sessions.initialize();
  const handles: FauxProviderHandle[] = [];
  registry = new HarnessRegistry(sessions, (connection) => {
    const faux = fauxProvider({
      tokensPerSecond: options.tokensPerSecond ?? 0,
      models: [
        {
          id: "fixture-model",
          contextWindow: options.contextWindow ?? 128_000,
          maxTokens: 4096,
          // 复刻 model-runtime 的规则：视觉能力由连接声明。faux 默认 ["text","image"]，
          // 照搬会让夹具永远支持图像，把"未声明 vision 就静默降级"这类故障测掉。
          input: connection.vision ? ["text", "image"] : ["text"],
        },
      ],
    });
    faux.setResponses(responseBatches.shift() ?? []);
    handles.push(faux);
    const models = createModels();
    models.setProvider(faux.provider);
    return {
      models,
      model: faux.getModel(),
      disposeCredential() {},
    };
  }, options.toolFactory ?? (() => []), options.interactionTimeoutMs, {
    projectScope: () => ({ targets: () => [], assertInProject: async () => undefined }),
    loadSettings: async () => ({ settings: EMPTY_SETTINGS, alwaysPath: join(dataDir, "settings.json") }),
    workspacesRoot: join(dataDir, "workspaces"),
    // 资源只从夹具目录加载，不读用户主目录（SDD 17）。
    loadResources: (resourceOptions) => loadResources({
      ...resourceOptions,
      env: { GLAUX_HOME: join(dataDir, "home") },
      builtinSkillsDir: join(dataDir, "builtin-skills"),
      builtinAgentsDir: join(dataDir, "builtin-agents"),
    }),
    ...options.permission,
  });
  const commands = new CommandService(sessions, registry);
  const broker = new SseBroker(registry);

  return {
    dataDir,
    sessions,
    registry,
    commands,
    broker,
    handles,
    async close() {
      await registry?.close();
      await sessions.close();
    },
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
