import { loadRuntimeConfig } from "./config.js";
import { CommandService } from "./pi/command-service.js";
import { HarnessRegistry } from "./pi/harness-registry.js";
import { SessionService } from "./pi/session-service.js";
import { buildServer } from "./transport/server.js";
import { SseBroker } from "./transport/sse-broker.js";

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
    return { version: "0.1.0" };
  },
  routes: { sessions, commands, registry, broker },
});

const shutdown = async () => {
  await server.close();
  await registry?.close();
  await sessions.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: config.host, port: config.port });
