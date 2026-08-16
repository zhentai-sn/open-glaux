import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  PERMISSION_MODES,
  SESSION_STATUSES,
  type CreateSessionInput,
  type PatchSessionInput,
  type TransportCommand,
  type ViewerContext,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import type { CommandService } from "../pi/command-service.js";
import type { HarnessRegistry } from "../pi/harness-registry.js";
import type { SessionService } from "../pi/session-service.js";
import { encodeSse, type SseBroker } from "./sse-broker.js";

export interface RouteDependencies {
  sessions: SessionService;
  commands: CommandService;
  registry: HarnessRegistry;
  broker: SseBroker;
}

export function registerRoutes(
  server: FastifyInstance,
  dependencies: RouteDependencies,
): void {
  const { sessions, commands, registry, broker } = dependencies;

  server.get("/agent-api/v1/sessions", async (request) => {
    const status = (request.query as { status?: string }).status;
    if (
      status !== undefined &&
      !SESSION_STATUSES.includes(status as (typeof SESSION_STATUSES)[number])
    ) {
      throw new RuntimeError("invalid_request", "Invalid session status.", 400);
    }
    return sessions.listSessions(status as "active" | "archived" | undefined);
  });

  server.post("/agent-api/v1/sessions", async (request, reply) => {
    const body = parseCreateSession(request.body);
    const result = await sessions.createSession(body);
    return reply.status(result.created ? 201 : 200).send(result.view);
  });

  server.get("/agent-api/v1/sessions/:sessionId", async (request) => {
    return sessions.getSession(sessionIdFrom(request));
  });

  server.patch("/agent-api/v1/sessions/:sessionId", async (request) => {
    const sessionId = sessionIdFrom(request);
    const patch = parsePatchSession(request.body);
    const busy = registry.getPhase(sessionId) !== "idle";
    if (
      busy &&
      (patch.status !== undefined ||
        patch.provider !== undefined ||
        patch.model !== undefined)
    ) {
      throw new RuntimeError("session_busy", "Session is already generating.", 409);
    }
    return sessions.patchSession(sessionId, patch);
  });

  server.delete("/agent-api/v1/sessions/:sessionId", async (request, reply) => {
    const sessionId = sessionIdFrom(request);
    if (registry.getPhase(sessionId) !== "idle") {
      throw new RuntimeError("session_busy", "Session is already generating.", 409);
    }
    await registry.evict(sessionId);
    await sessions.deleteSession(sessionId);
    return reply.status(204).send();
  });

  server.post(
    "/agent-api/v1/sessions/:sessionId/commands",
    async (request, reply) => {
      const command = parseCommand(request.body);
      const view = await commands.accept(sessionIdFrom(request), command);
      return reply.status(202).send(view);
    },
  );

  server.get(
    "/agent-api/v1/sessions/:sessionId/events",
    async (request, reply) => {
      const sessionId = sessionIdFrom(request);
      await sessions.getSession(sessionId);
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const disconnect = await broker.connect(
        sessionId,
        () => sessions.getSession(sessionId),
        (event) => {
          reply.raw.write(encodeSse(event));
        },
      );
      request.raw.once("close", disconnect);
    },
  );
}

function sessionIdFrom(request: FastifyRequest): string {
  const sessionId = (request.params as { sessionId?: string }).sessionId;
  if (!sessionId || !isUuid(sessionId)) {
    throw new RuntimeError("invalid_request", "A valid session UUID is required.", 400);
  }
  return sessionId;
}

function parseCreateSession(value: unknown): CreateSessionInput {
  const body = asObject(value);
  if (!isUuid(body.session_id)) {
    throw new RuntimeError("invalid_request", "A valid session UUID is required.", 400);
  }
  if (
    body.permission_mode !== undefined &&
    !PERMISSION_MODES.includes(
      body.permission_mode as (typeof PERMISSION_MODES)[number],
    )
  ) {
    throw new RuntimeError("invalid_request", "Invalid permission mode.", 400);
  }
  return {
    session_id: body.session_id,
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(body.permission_mode
      ? {
          permission_mode:
            body.permission_mode as (typeof PERMISSION_MODES)[number],
        }
      : {}),
  };
}

function parsePatchSession(value: unknown): PatchSessionInput {
  const body = asObject(value);
  if (
    body.status !== undefined &&
    !SESSION_STATUSES.includes(body.status as (typeof SESSION_STATUSES)[number])
  ) {
    throw new RuntimeError("invalid_request", "Invalid session status.", 400);
  }
  if (
    body.permission_mode !== undefined &&
    !PERMISSION_MODES.includes(
      body.permission_mode as (typeof PERMISSION_MODES)[number],
    )
  ) {
    throw new RuntimeError("invalid_request", "Invalid permission mode.", 400);
  }
  return {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(body.status
      ? { status: body.status as (typeof SESSION_STATUSES)[number] }
      : {}),
    ...(body.permission_mode
      ? {
          permission_mode:
            body.permission_mode as (typeof PERMISSION_MODES)[number],
        }
      : {}),
    ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
  };
}

function parseCommand(value: unknown): TransportCommand {
  const body = asObject(value);
  if (!isUuid(body.command_id)) {
    throw new RuntimeError("invalid_request", "A valid command UUID is required.", 400);
  }
  if (body.type === "abort") {
    if (body.content !== undefined || body.connection !== undefined) {
      throw new RuntimeError(
        "invalid_request",
        "Abort does not accept content or connection.",
        400,
      );
    }
    return { command_id: body.command_id, type: "abort" };
  }
  if (body.type !== "prompt" && body.type !== "regenerate") {
    throw new RuntimeError("invalid_request", "Invalid command type.", 400);
  }
  const connection = parseConnection(body.connection);
  if (body.type === "prompt") {
    if (typeof body.content !== "string" || !body.content.trim()) {
      throw new RuntimeError("invalid_request", "Prompt content is required.", 400);
    }
    const viewer = parseViewer(body.viewer);
    return {
      command_id: body.command_id,
      type: "prompt",
      content: body.content,
      connection,
      ...(viewer ? { viewer } : {}),
    };
  }
  if (body.content !== undefined) {
    throw new RuntimeError(
      "invalid_request",
      "Regenerate does not accept content.",
      400,
    );
  }
  return { command_id: body.command_id, type: "regenerate", connection };
}

function parseConnection(value: unknown) {
  const connection = asObject(value);
  if (
    typeof connection.provider !== "string" ||
    typeof connection.model !== "string"
  ) {
    throw new RuntimeError(
      "invalid_request",
      "Connection provider and model are required.",
      400,
    );
  }
  return {
    provider: connection.provider,
    model: connection.model,
    ...(typeof connection.base_url === "string"
      ? { base_url: connection.base_url }
      : {}),
    ...(typeof connection.context_window === "number"
      ? { context_window: connection.context_window }
      : {}),
    ...(typeof connection.max_tokens === "number"
      ? { max_tokens: connection.max_tokens }
      : {}),
    ...(typeof connection.credential === "string"
      ? { credential: connection.credential }
      : {}),
  };
}

/** 查看器上下文：缺省 undefined；给了必须是对象，字段逐个校验类型，未知字段忽略。 */
function parseViewer(value: unknown): ViewerContext | undefined {
  if (value === undefined || value === null) return undefined;
  const v = asObject(value);
  const out: ViewerContext = {};
  for (const key of ["image_id", "task", "modality", "method"] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== "string") {
        throw new RuntimeError("invalid_request", `viewer.${key} must be a string.`, 400);
      }
      out[key] = v[key];
    }
  }
  if (v.cubs_cf !== undefined) {
    if (typeof v.cubs_cf !== "number" || !Number.isFinite(v.cubs_cf)) {
      throw new RuntimeError("invalid_request", "viewer.cubs_cf must be a number.", 400);
    }
    out.cubs_cf = v.cubs_cf;
  }
  if (v.roi_box !== undefined) {
    const box = v.roi_box;
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      throw new RuntimeError("invalid_request", "viewer.roi_box must be [x, y, w, h].", 400);
    }
    out.roi_box = box as [number, number, number, number];
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("invalid_request", "A JSON object is required.", 400);
  }
  return value as Record<string, unknown>;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
