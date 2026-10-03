import { randomUUID } from "node:crypto";

import Fastify, { LogController } from "fastify";

import { RuntimeError, safeError } from "../errors.js";
import type { ConnectionProbe } from "../pi/connection-probe.js";
import { registerAtlasRoutes, type AtlasRouteDependencies } from "./atlas-routes.js";
import { registerConnectionRoutes } from "./connection-routes.js";
import type { RouteDependencies } from "./routes.js";
import { registerRoutes } from "./routes.js";
import { redact } from "../security/redact.js";

export interface BuildServerOptions {
  healthCheck?: () => Promise<Record<string, unknown>>;
  routes?: RouteDependencies;
  probe?: ConnectionProbe;
  atlas?: AtlasRouteDependencies;
}

/**
 * 请求体上限。Fastify 默认 1 MiB，装不下内联图像——`/atlas/describe` 的单图 12 MiB
 * 与 prompt 附件合计 24 MiB（SDD 00 §4.3）都在其之上，留出余量后取 40 MiB；
 * 真正的语义上限由各路由的校验负责，这里只是不让传输层先一步截断。
 */
const BODY_LIMIT_BYTES = 40 * 1024 * 1024;

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
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
  if (options.atlas) registerAtlasRoutes(server, options.atlas);

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
    // Fastify 自身的请求错误（如带 JSON content-type 却无请求体）是客户端问题，返回 400 而不是 500。
    const clientStatus = (error as { statusCode?: unknown }).statusCode;
    const runtimeError =
      error instanceof RuntimeError
        ? error
        : typeof clientStatus === "number" && clientStatus >= 400 && clientStatus < 500
          ? new RuntimeError("invalid_request", "The request is malformed.", 400, { cause: error })
          : new RuntimeError(
              "internal_error",
              "Agent Runtime encountered an unexpected error.",
              500,
              { cause: error },
            );
    // 内部错误附上原始异常的类型与消息（脱敏），否则日志里无从排查；响应体仍只给通用信息。
    const cause = error instanceof RuntimeError
      ? undefined
      : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    request.log.error(
      redact({ code: runtimeError.code, message: runtimeError.message, traceId, ...(cause ? { cause } : {}) }),
      "request failed",
    );
    void reply
      .status(runtimeError.statusCode)
      .send(safeError(runtimeError, traceId));
  });

  return server;
}
