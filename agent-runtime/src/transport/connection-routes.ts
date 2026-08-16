import type { FastifyInstance } from "fastify";

import { RuntimeError } from "../errors.js";
import { parseProviderId } from "../pi/compatibility.js";
import type { ConnectionProbe, ProbeInput } from "../pi/connection-probe.js";

/**
 * `/agent-api/v1/connection/*`——模型连接探测（测试连通 / 列模型）。
 * 独立于会话路由注册：不依赖 SessionService，前端 ConnectionConfig 弹窗直接调用。
 */
export function registerConnectionRoutes(
  server: FastifyInstance,
  probe: ConnectionProbe,
): void {
  server.post("/agent-api/v1/connection/test", async (request) => {
    return probe.test(parseProbeInput(request.body));
  });

  server.post("/agent-api/v1/connection/models", async (request) => {
    return probe.listModels(parseProbeInput(request.body));
  });
}

function parseProbeInput(value: unknown): ProbeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("invalid_request", "A JSON object is required.", 400);
  }
  const body = value as Record<string, unknown>;
  const provider = parseProviderId(body.provider); // 兼容前端历史枚举 openai_compatible
  if (!provider) {
    throw new RuntimeError(
      "invalid_request",
      `Unsupported provider: ${String(body.provider)}`,
      400,
    );
  }
  if (body.base_url !== undefined && typeof body.base_url !== "string") {
    throw new RuntimeError("invalid_request", "base_url must be a string.", 400);
  }
  if (body.credential !== undefined && typeof body.credential !== "string") {
    throw new RuntimeError("invalid_request", "credential must be a string.", 400);
  }
  return {
    provider,
    ...(typeof body.base_url === "string" ? { base_url: body.base_url } : {}),
    ...(typeof body.credential === "string" ? { credential: body.credential } : {}),
  };
}
