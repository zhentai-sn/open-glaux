import { loadRuntimeConfig } from "./config.js";
import { SessionService } from "./pi/session-service.js";
import { buildServer } from "./transport/server.js";

const config = loadRuntimeConfig();
const sessions = new SessionService(config);
await sessions.initialize();

const server = buildServer({
  healthCheck: async () => {
    await sessions.initialize();
    return { version: "0.1.0" };
  },
});

const shutdown = async () => {
  await server.close();
  await sessions.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: config.host, port: config.port });
