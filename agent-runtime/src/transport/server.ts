import { randomUUID } from "node:crypto";

import Fastify, { LogController } from "fastify";

import { RuntimeError, safeError } from "../errors.js";
import type { ConnectionProbe } from "../pi/connection-probe.js";
import { registerConnectionRoutes } from "./connection-routes.js";
import type { RouteDependencies } from "./routes.js";
import { registerRoutes } from "./routes.js";
import { redact } from "../security/redact.js";

export interface BuildServerOptions {
  healthCheck?: () => Promise<Record<string, unknown>>;
  routes?: RouteDependencies;
  probe?: ConnectionProbe;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: {
      level: process.env.GLAUX_AGENT_LOG_LEVEL ?? "info",
      serializers: {
        req(request) {
          return redact({
            method: request.method,
            url: request.url,
            headers: request.headers,
          });
        },
        res(response) {
          return { statusCode: response.statusCode };
        },
      },
    },
    logController: new LogController({ disableRequestLogging: true }),
  });

  server.get("/agent-api/v1/health", async () => ({
    status: "ok",
    adapter: "ok",
    pi: "ok",
    storage: "ok",
    ...((await options.healthCheck?.()) ?? {}),
  }));
  if (options.routes) registerRoutes(server, options.routes);
  if (options.probe) registerConnectionRoutes(server, options.probe);

  server.setNotFoundHandler((request, reply) => {
    const traceId = request.id || randomUUID();
    return reply
      .status(404)
      .send(
        safeError(
          new RuntimeError("not_found", "The requested Runtime route was not found.", 404),
          traceId,
        ),
      );
  });

  server.setErrorHandler((error, request, reply) => {
    const traceId = request.id || randomUUID();
    const runtimeError =
      error instanceof RuntimeError
        ? error
        : new RuntimeError(
            "internal_error",
            "Agent Runtime encountered an unexpected error.",
            500,
            { cause: error },
          );
    request.log.error(
      redact({ code: runtimeError.code, message: runtimeError.message, traceId }),
      "request failed",
    );
    void reply
      .status(runtimeError.statusCode)
      .send(safeError(runtimeError, traceId));
  });

  return server;
}
