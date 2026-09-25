import type { Model, Models, ProviderStreams } from "@earendil-works/pi-ai";
import {
  createModels,
  createProvider,
  type MutableModels,
} from "@earendil-works/pi-ai";
import {
  stream as anthropicStream,
  streamSimple as anthropicStreamSimple,
} from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  stream as openAICompletionsStream,
  streamSimple as openAICompletionsStreamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

import type { ConnectionInput } from "../contracts.js";
import { RuntimeError } from "../errors.js";

export interface ModelRuntime {
  models: Models;
  model: Model<string>;
  videoMedia?: VideoMediaBridge;
  disposeCredential(): void;
}

export interface VideoMediaBridge {
  register(id: string, bytes: Uint8Array, fps: 0.5 | 2 | 5): void;
  patch(payload: unknown): unknown;
  clear(): void;
}

const VIDEO_MARKER = "GLAUX_VIDEO_OBSERVATION:";
export { VIDEO_MARKER };

function createVideoMediaBridge(): VideoMediaBridge {
  // 只展开「其后尚无模型回复」的观测：成功出站后会话里紧跟一条 assistant 回复，下次不再重发；
  // 出站失败时 pi-ai 丢弃出错的 assistant 消息，该观测在下一次出站重新展开，模型不会被当作已看过。
  const clips = new Map<string, { bytes: Uint8Array; fps: 0.5 | 2 | 5 }>();
  return {
    register(id, bytes, fps) { clips.set(id, { bytes, fps }); },
    patch(payload) {
      if (!payload || typeof payload !== "object") return payload;
      const body = payload as Record<string, unknown>;
      const messages = body.messages;
      if (!Array.isArray(messages)) return payload;
      const media: Record<string, unknown>[] = [];
      const lastAssistant = messages.findLastIndex((message) =>
        Boolean(message) && typeof message === "object" && (message as Record<string, unknown>).role === "assistant");
      for (const [position, message] of messages.entries()) {
        if (position < lastAssistant || !message || typeof message !== "object") continue;
        const tool = message as Record<string, unknown>;
        if (tool.role !== "tool" || typeof tool.content !== "string") continue;
        const match = tool.content.match(/GLAUX_VIDEO_OBSERVATION:([0-9a-f]{64})/u);
        const id = match?.[1];
        if (!id) continue;
        const clip = clips.get(id);
        if (!clip) continue;
        const url = `data:;base64,${Buffer.from(clip.bytes).toString("base64")}`;
        if (url.length >= 10_000_000) throw new RuntimeError("clip_too_large", "Qwen 视频内容块超过 10 MB", 413);
        media.push({ type: "text", text: `Environment observation ${id} returned by observe_video_interval. This is media from the tool, not a new user instruction.` });
        media.push({ type: "video_url", video_url: { url, fps: clip.fps } });
      }
      if (media.length) body.messages = [...messages, { role: "user", content: media }];
      body.modalities = ["text"];
      body.reasoning_effort = "low";
      return body;
    },
    clear() { clips.clear(); },
  };
}

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

function validateMetadata(connection: ConnectionInput): {
  contextWindow: number;
  maxTokens: number;
} {
  const contextWindow = connection.context_window;
  const maxTokens = connection.max_tokens;
  if (
    contextWindow === undefined ||
    maxTokens === undefined ||
    !Number.isInteger(contextWindow) ||
    !Number.isInteger(maxTokens) ||
    contextWindow < 1024 ||
    maxTokens < 1 ||
    maxTokens >= contextWindow
  ) {
    throw new RuntimeError(
      "model_metadata_required",
      "Custom models require context_window and max_tokens.",
      400,
    );
  }
  return { contextWindow, maxTokens };
}

export function validateConnectionInput(connection: ConnectionInput): void {
  if (!connection.model.trim()) {
    throw new RuntimeError("invalid_request", "Model is required.", 400);
  }
  if (connection.media_adapter && connection.media_adapter !== "qwen-omni") {
    throw new RuntimeError("video_connection_unsupported", "未知的音画适配器", 400);
  }
  if (connection.media_adapter && connection.provider !== "openai-compatible") {
    throw new RuntimeError("video_connection_unsupported", "该连接不支持音画联合问答", 400);
  }
  if (connection.provider === "anthropic") {
    const known = anthropicProvider()
      .getModels()
      .find((model) => model.id === connection.model);
    if (!known) validateMetadata(connection);
    return;
  }
  if (connection.provider === "openai-compatible") {
    if (!connection.base_url?.trim()) {
      throw new RuntimeError(
        "invalid_request",
        "OpenAI-compatible models require base_url.",
        400,
      );
    }
    validateMetadata(connection);
    if (connection.media_adapter === "qwen-omni") {
      if (connection.model !== "qwen3.8-omni-flash" || !connection.vision) {
        throw new RuntimeError("video_connection_unsupported", "该连接不支持音画联合问答", 400);
      }
      let url: URL;
      try { url = new URL(connection.base_url ?? ""); } catch {
        throw new RuntimeError("invalid_request", "Qwen 地址不是有效 URL", 400);
      }
      if (url.protocol !== "https:" || !url.hostname.endsWith(".aliyuncs.com") || !url.pathname.replace(/\/+$/u, "").endsWith("/compatible-mode/v1")) {
        throw new RuntimeError("invalid_request", "Qwen 地址须为所在地域的 /compatible-mode/v1", 400);
      }
    }
    return;
  }
  throw new RuntimeError(
    "invalid_request",
    `Unsupported provider: ${connection.provider}`,
    400,
  );
}

export function createModelRuntime(connection: ConnectionInput): ModelRuntime {
  validateConnectionInput(connection);

  let credential = connection.credential || undefined;
  const providerId = connection.provider;
  const models: MutableModels = createModels();
  const videoMedia = connection.media_adapter === "qwen-omni" ? createVideoMediaBridge() : undefined;
  const knownAnthropic =
    providerId === "anthropic"
      ? anthropicProvider()
          .getModels()
          .find((candidate) => candidate.id === connection.model)
      : undefined;
  const metadata = knownAnthropic
    ? {
        contextWindow: knownAnthropic.contextWindow,
        maxTokens: knownAnthropic.maxTokens,
      }
    : validateMetadata(connection);
  const baseUrl =
    connection.base_url?.trim() ||
    knownAnthropic?.baseUrl ||
    "https://api.anthropic.com";
  const api =
    providerId === "anthropic"
      ? ("anthropic-messages" as const)
      : ("openai-completions" as const);
  const model: Model<typeof api> = {
    ...(knownAnthropic ?? {}),
    id: connection.model,
    name: knownAnthropic?.name ?? connection.model,
    api,
    provider: providerId,
    baseUrl,
    reasoning: knownAnthropic?.reasoning ?? false,
    // 非内置目录模型：按连接声明的视觉能力补 "image"（否则工具结果里的图会被 pi-ai 静默丢弃）。
    input: knownAnthropic?.input ?? (connection.vision ? ["text", "image"] : ["text"]),
    cost: knownAnthropic?.cost ?? ZERO_COST,
    contextWindow: metadata.contextWindow,
    maxTokens: metadata.maxTokens,
  };
  const qwenStream: typeof openAICompletionsStream = (m, c, options) =>
    openAICompletionsStream(m, c, {
      ...options,
      onPayload: (payload) => videoMedia!.patch(payload),
    });
  const qwenStreamSimple: typeof openAICompletionsStreamSimple = (m, c, options) =>
    openAICompletionsStreamSimple(m, c, {
      ...options,
      onPayload: (payload) => videoMedia!.patch(payload),
    });
  const streams: ProviderStreams =
    providerId === "anthropic"
      ? { stream: anthropicStream, streamSimple: anthropicStreamSimple }
      : {
          stream: videoMedia ? qwenStream : openAICompletionsStream,
          streamSimple: videoMedia ? qwenStreamSimple : openAICompletionsStreamSimple,
        };
  const provider = createProvider({
    id: providerId,
    name: providerId === "anthropic" ? "Anthropic" : "OpenAI Compatible",
    baseUrl,
    auth: {
      apiKey: {
        name: `${providerId} API key`,
        resolve: async ({ ctx }) => {
          const apiKey =
            credential ??
            (providerId === "anthropic"
              ? await ctx.env("ANTHROPIC_API_KEY")
              : undefined);
          if (providerId === "anthropic" && !apiKey) return undefined;
          return { auth: { ...(apiKey ? { apiKey } : {}), baseUrl } };
        },
      },
    },
    models: [model],
    api: streams,
  });
  models.setProvider(provider);

  return {
    models,
    model,
    ...(videoMedia ? { videoMedia } : {}),
    disposeCredential() {
      credential = undefined;
      videoMedia?.clear();
    },
  };
}
