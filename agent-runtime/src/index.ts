import { loadRuntimeConfig } from "./config.js";
import { CommandService } from "./pi/command-service.js";
import { createConnectionProbe } from "./pi/connection-probe.js";
import { HarnessRegistry } from "./pi/harness-registry.js";
import { createModelRuntime } from "./pi/model-runtime.js";
import { SessionService } from "./pi/session-service.js";
import { buildServer } from "./transport/server.js";
import { SseBroker } from "./transport/sse-broker.js";
import { RUNTIME_VERSION } from "./version.js";

const config = loadRuntimeConfig();
let registry: HarnessRegistry | undefined;
const sessions = new SessionService({
  ...config,
  phaseForSession: (sessionId) => registry?.getPhase(sessionId) ?? "idle",
});
await sessions.initialize();
registry = new HarnessRegistry(sessions);
const commands = new CommandService(sessions, registry);
const broker = new SseBroker(registry);

const server = buildServer({
  healthCheck: async () => {
    await sessions.initialize();
    return { version: RUNTIME_VERSION };
  },
  routes: { sessions, commands, registry, broker },
  probe: createConnectionProbe(),
  atlas: { runtimeFactory: createModelRuntime },
});

const shutdown = async () => {
  await server.close();
  await registry?.close();
  await sessions.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: config.host, port: config.port });
