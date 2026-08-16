import type { FastifyInstance } from "fastify";

import type { ConnectionInput } from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { parseProviderId } from "../pi/compatibility.js";
import type { ModelRuntime } from "../pi/model-runtime.js";
import { describeImage, type AtlasDescription, type ImageInput } from "../pi/vision.js";

/**
 * `/agent-api/v1/atlas/describe`——为图谱案例生成 SDD 03 §7.6 结构化描述。
 *
 * 调用方是前端导入向导或 backend CLI（凭据只在本次请求内存中存活，不落日志、不经 backend）。
 * 独立于会话路由注册：不依赖 SessionService。
 */
export interface AtlasRouteDependencies {
  runtimeFactory: (connection: ConnectionInput) => ModelRuntime;
  /** 单次描述上限（毫秒）。 */
  timeoutMs?: number;
}

export interface DescribeResponse {
  description: AtlasDescription;
  statement_version: "v1";
}

const MAX_IMAGE_BASE64 = 12 * 1024 * 1024; // ~9MB 图

export function registerAtlasRoutes(server: FastifyInstance, deps: AtlasRouteDependencies): void {
  server.post("/agent-api/v1/atlas/describe", async (request): Promise<DescribeResponse> => {
    const { image, hint, connection } = parseDescribeBody(request.body);
    const runtime = deps.runtimeFactory(connection);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 120_000);
    try {
      const description = await describeImage(runtime, {
        image,
        ...(hint ? { hint } : {}),
        signal: controller.signal,
      });
      return { description, statement_version: "v1" };
    } finally {
      clearTimeout(timer);
      runtime.disposeCredential();
    }
  });
}

function bad(message: string): RuntimeError {
  return new RuntimeError("invalid_request", message, 400);
}

export function parseConnectionInput(value: unknown): ConnectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad("connection is required.");
  const c = value as Record<string, unknown>;
  const provider = parseProviderId(c.provider);
  if (!provider) throw bad(`Unsupported provider: ${String(c.provider)}`);
  if (typeof c.model !== "string" || !c.model.trim()) throw bad("connection.model is required.");
  const credential = typeof c.credential === "string" ? c.credential : typeof c.api_key === "string" ? c.api_key : undefined;
  const out: ConnectionInput = { provider, model: c.model, vision: true };
  if (typeof c.base_url === "string" && c.base_url.trim()) out.base_url = c.base_url;
  if (typeof c.context_window === "number") out.context_window = c.context_window;
  if (typeof c.max_tokens === "number") out.max_tokens = c.max_tokens;
  if (credential) out.credential = credential;
  return out;
}

function parseDescribeBody(value: unknown): { image: ImageInput; hint?: string; connection: ConnectionInput } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad("A JSON object is required.");
  const body = value as Record<string, unknown>;
  const data = body.image_base64;
  if (typeof data !== "string" || !data.trim()) throw bad("image_base64 is required.");
  if (data.length > MAX_IMAGE_BASE64) throw bad("image too large.");
  const mimeType = typeof body.mime_type === "string" && body.mime_type ? body.mime_type : "image/png";
  const hint = typeof body.hint === "string" ? body.hint : undefined;
  return {
    image: { data: data.trim(), mimeType },
    ...(hint ? { hint } : {}),
    connection: parseConnectionInput(body.connection),
  };
}
