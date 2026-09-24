import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  MAX_PROMPT_IMAGE_BASE64,
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGES_TOTAL_BASE64,
  PERMISSION_MODES,
  PROMPT_IMAGE_MIME_TYPES,
  SESSION_STATUSES,
  type CreateSessionInput,
  type PatchSessionInput,
  type PromptImage,
  type TransportCommand,
  type ViewerContext,
  type ObjectKind,
  type Axis,
  type Calibration,
  type Focus,
  type Index,
  type Region,
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
    if (
      body.content !== undefined ||
      body.connection !== undefined ||
      body.images !== undefined
    ) {
      throw new RuntimeError(
        "invalid_request",
        "Abort does not accept content, connection or images.",
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
    if (body.content !== undefined && typeof body.content !== "string") {
      throw new RuntimeError("invalid_request", "Prompt content must be a string.", 400);
    }
    const content = typeof body.content === "string" ? body.content : "";
    const images = parsePromptImages(body.images);
    // 文本与附件至少其一非空（SDD 00 §4.3）——纯图消息合法。
    if (!content.trim() && images.length === 0) {
      throw new RuntimeError(
        "invalid_request",
        "Prompt requires content or at least one image.",
        400,
      );
    }
    const viewer = parseViewer(body.viewer);
    return {
      command_id: body.command_id,
      type: "prompt",
      content,
      ...(images.length ? { images } : {}),
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
  if (body.images !== undefined) {
    throw new RuntimeError(
      "invalid_request",
      "Regenerate does not accept images.",
      400,
    );
  }
  const viewer = parseViewer(body.viewer);
  return { command_id: body.command_id, type: "regenerate", connection, ...(viewer ? { viewer } : {}) };
}

/**
 * 附件校验（SDD 00 §4.3）——MIME 白名单 + 单张 / 张数 / 合计三重上限。
 * UI 侧已拦截同一组上限；此处是独立的第二道，因为 runtime 也接受非浏览器调用方。
 */
function parsePromptImages(value: unknown): PromptImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new RuntimeError("invalid_request", "images must be an array.", 400);
  }
  if (value.length > MAX_PROMPT_IMAGES) {
    throw new RuntimeError(
      "invalid_request",
      `At most ${MAX_PROMPT_IMAGES} images per message.`,
      400,
    );
  }
  let total = 0;
  return value.map((item) => {
    const image = asObject(item);
    const data = image.data;
    const mimeType = image.mime_type;
    if (typeof data !== "string" || !data.trim()) {
      throw new RuntimeError("invalid_request", "images[].data is required.", 400);
    }
    if (
      typeof mimeType !== "string" ||
      !PROMPT_IMAGE_MIME_TYPES.includes(
        mimeType as (typeof PROMPT_IMAGE_MIME_TYPES)[number],
      )
    ) {
      throw new RuntimeError(
        "invalid_request",
        `images[].mime_type must be one of ${PROMPT_IMAGE_MIME_TYPES.join(", ")}.`,
        400,
      );
    }
    if (data.length > MAX_PROMPT_IMAGE_BASE64) {
      throw new RuntimeError("invalid_request", "Image is too large.", 400);
    }
    total += data.length;
    if (total > MAX_PROMPT_IMAGES_TOTAL_BASE64) {
      throw new RuntimeError("invalid_request", "Images are too large in total.", 400);
    }
    return { data, mime_type: mimeType };
  });
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
  if (connection.media_adapter !== undefined && connection.media_adapter !== "qwen-omni") {
    throw new RuntimeError("invalid_request", "Unknown media adapter.", 400);
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
    // 必须透传：丢掉它模型就按纯文本模型构造，pi-ai 会把用户消息里的图静默换成占位符。
    ...(typeof connection.vision === "boolean"
      ? { vision: connection.vision }
      : {}),
    ...(connection.media_adapter === "qwen-omni"
      ? { media_adapter: "qwen-omni" as const }
      : {}),
  };
}

const OBJECT_KINDS = new Set<ObjectKind>(["image", "volume", "slide", "video"]);
const AXIS_NAMES = new Set(["x", "y", "z", "t", "level"]);
const INDEX_AXES = ["z", "t", "level"] as const;

function invalid(path: string, expected: string): never {
  throw new RuntimeError("invalid_request", `${path} must be ${expected}.`, 400);
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) invalid(path, "a non-empty string");
  return value;
}

function finiteAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "a finite number");
  return value;
}

function kindAt(value: unknown, path: string): ObjectKind {
  if (typeof value !== "string" || !OBJECT_KINDS.has(value as ObjectKind)) invalid(path, "an ObjectKind");
  return value as ObjectKind;
}

function parseIndex(value: unknown): Index {
  const input = asObject(value);
  const index: Index = {};
  for (const axis of INDEX_AXES) {
    if (input[axis] === undefined || input[axis] === null) continue;
    const n = finiteAt(input[axis], `viewer.focus.index.${axis}`);
    if (!Number.isInteger(n) || n < 0) invalid(`viewer.focus.index.${axis}`, "a non-negative integer");
    index[axis] = n;
  }
  if (INDEX_AXES.filter((axis) => index[axis] !== undefined).length > 1) invalid("viewer.focus.index", "at most one axis");
  return index;
}

function parseRegion(value: unknown): Region | null {
  if (value === null) return null;
  const input = asObject(value);
  const kind = stringAt(input.kind, "viewer.focus.region.kind");
  if (kind === "box") {
    const x0 = finiteAt(input.x0, "viewer.focus.region.x0");
    const y0 = finiteAt(input.y0, "viewer.focus.region.y0");
    const x1 = finiteAt(input.x1, "viewer.focus.region.x1");
    const y1 = finiteAt(input.y1, "viewer.focus.region.y1");
    if (x0 >= x1 || y0 >= y1) invalid("viewer.focus.region", "an ordered box");
    return { kind, x0, y0, x1, y1 };
  }
  if (kind === "column_window") {
    const x0 = finiteAt(input.x0, "viewer.focus.region.x0");
    const x1 = finiteAt(input.x1, "viewer.focus.region.x1");
    if (x0 >= x1) invalid("viewer.focus.region", "an ordered column window");
    return { kind, x0, x1 };
  }
  if (kind === "slice") {
    const z = finiteAt(input.z, "viewer.focus.region.z");
    if (!Number.isInteger(z) || z < 0) invalid("viewer.focus.region.z", "a non-negative integer");
    return { kind, z };
  }
  if (kind === "frame_range") {
    const t0 = finiteAt(input.t0, "viewer.focus.region.t0");
    const t1 = finiteAt(input.t1, "viewer.focus.region.t1");
    if (!Number.isInteger(t0) || !Number.isInteger(t1) || t0 < 0 || t0 >= t1) invalid("viewer.focus.region", "an ordered non-negative frame range");
    if (input.seed === undefined || input.seed === null) return { kind, t0, t1 };
    const seed = asObject(input.seed);
    const t = finiteAt(seed.t, "viewer.focus.region.seed.t");
    if (!Number.isInteger(t) || t < t0 || t > t1) invalid("viewer.focus.region.seed.t", "an integer within the frame range");
    if (!Array.isArray(seed.box) || seed.box.length !== 4 || !seed.box.every((n) => typeof n === "number" && Number.isFinite(n))) {
      invalid("viewer.focus.region.seed.box", "[x0, y0, x1, y1]");
    }
    const box = seed.box as [number, number, number, number];
    if (box[0] >= box[2] || box[1] >= box[3]) invalid("viewer.focus.region.seed.box", "an ordered box");
    return { kind, t0, t1, seed: { t, box } };
  }
  return invalid("viewer.focus.region.kind", "a supported Region kind");
}

function parseObject(value: unknown): NonNullable<ViewerContext["object"]> {
  const input = asObject(value);
  const id = stringAt(input.id, "viewer.object.id");
  const kind = kindAt(input.kind, "viewer.object.kind");
  if (!Array.isArray(input.axes) || input.axes.length < 2) invalid("viewer.object.axes", "an Axis array");
  const axes: Axis[] = input.axes.map((value: unknown, i: number) => {
    const axis = asObject(value);
    const name = stringAt(axis.name, `viewer.object.axes[${i}].name`);
    if (!AXIS_NAMES.has(name)) invalid(`viewer.object.axes[${i}].name`, "an AxisName");
    const size = finiteAt(axis.size, `viewer.object.axes[${i}].size`);
    if (!Number.isInteger(size) || size <= 0) invalid(`viewer.object.axes[${i}].size`, "a positive integer");
    const parsed: Axis = { name: name as Axis["name"], size };
    if (axis.spacing !== undefined) parsed.spacing = axis.spacing === null ? null : finiteAt(axis.spacing, `viewer.object.axes[${i}].spacing`);
    if (axis.unit !== undefined) parsed.unit = stringAt(axis.unit, `viewer.object.axes[${i}].unit`);
    return parsed;
  });
  const required = kind === "image" ? ["x", "y"] : kind === "volume" ? ["x", "y", "z"] : kind === "slide" ? ["x", "y", "level"] : ["x", "y", "t"];
  if (axes.length !== required.length || axes.some((axis, i) => axis.name !== required[i])) invalid("viewer.object.axes", `the ${kind} axis order`);
  let calibration: Calibration | null = null;
  if (input.calibration !== null && input.calibration !== undefined) {
    const c = asObject(input.calibration);
    calibration = { kind: stringAt(c.kind, "viewer.object.calibration.kind"), value: c.value, source: stringAt(c.source, "viewer.object.calibration.source") };
    if (c.value === undefined) invalid("viewer.object.calibration.value", "present");
    if (c.provenance !== undefined) calibration.provenance = asObject(c.provenance);
  }
  return { id, kind, axes, calibration };
}

function parseFocus(value: unknown, object: NonNullable<ViewerContext["object"]>): Focus {
  const input = asObject(value);
  const objectId = stringAt(input.object_id, "viewer.focus.object_id");
  if (objectId !== object.id) invalid("viewer.focus.object_id", "equal to viewer.object.id");
  let kind = kindAt(input.kind, "viewer.focus.kind");
  if (kind !== object.kind) {
    console.warn(`viewer.focus.kind ${kind} 与 object.kind ${object.kind} 不一致，按对象重建`);
    kind = object.kind;
  }
  const index = parseIndex(input.index);
  const axis = (object.axes[2]?.name ?? null) as (typeof INDEX_AXES)[number] | null;
  for (const name of INDEX_AXES) if (index[name] !== undefined && name !== axis) invalid("viewer.focus.index", `the ${kind} axis`);
  if (axis !== null && index[axis] !== undefined && index[axis]! >= object.axes[2]!.size) invalid(`viewer.focus.index.${axis}`, "within axes bounds");
  const region = parseRegion(input.region);
  return { object_id: objectId, kind, index, region };
}

/** 查看器上下文只接受对象与焦点契约。 */
function parseViewer(value: unknown): ViewerContext | undefined {
  if (value === undefined || value === null) return undefined;
  const v = asObject(value);
  for (const key of ["image_id", "modality", "cubs_cf", "roi_box"] as const) {
    if (key in v) invalid(`viewer.${key}`, "omitted; use object/focus");
  }
  const out: ViewerContext = {};
  for (const key of ["collection", "task", "method"] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== "string") {
        throw new RuntimeError("invalid_request", `viewer.${key} must be a string.`, 400);
      }
      out[key] = v[key];
    }
  }
  if (v.object !== undefined || v.focus !== undefined) {
    if (v.object === undefined || v.focus === undefined) invalid("viewer.object/focus", "provided together");
    out.object = parseObject(v.object);
    out.focus = parseFocus(v.focus, out.object);
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
