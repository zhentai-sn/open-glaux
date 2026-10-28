import type { Api, Model, Models, ProviderStreams, StreamFunction, StreamOptions } from "@earendil-works/pi-ai";
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
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

import { THINKING_LEVELS, type ConnectionInput } from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { resolveOpencodeSessionHeaders } from "./opencode-session.js";

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

/**
 * 给 OpenCode 托管端点补 `x-opencode-session`（缺失即 400 MissingSessionID）。
 * 头由 pi 的 `options.headers` 落地：openai-completions 与 anthropic-messages 都把
 * 调用方头合并在内置头之后，因此不受各 API 默认头影响。
 */
function withOpencodeSession<TApi extends Api, TOptions extends StreamOptions>(
  streamFn: StreamFunction<TApi, TOptions>,
): StreamFunction<TApi, TOptions> {
  return (model, context, options) => {
    const headers = resolveOpencodeSessionHeaders(model, options);
    if (headers === undefined || headers === options?.headers) {
      return streamFn(model, context, options);
    }
    return streamFn(model, context, { ...options, headers } as TOptions);
  };
}

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

/** OpenCode Zen 的缺省端点（OpenAI 兼容的 chat/completions 族）；Go 订阅用 `/zen/go/v1`，由连接覆盖。 */
const OPENCODE_DEFAULT_BASE = "https://opencode.ai/zen/v1";

/** pi-ai 内置目录：命中即用目录里的窗口、输出上限、视觉能力与地址，缺省值不必用户手填。 */
function catalogModel(providerId: string, modelId: string) {
  const provider =
    providerId === "anthropic"
      ? anthropicProvider
      : providerId === "deepseek"
        ? deepseekProvider
        : undefined;
  return provider?.()
    .getModels()
    .find((model) => model.id === modelId);
}

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
  if (
    connection.thinking_level !== undefined &&
    !(THINKING_LEVELS as readonly string[]).includes(connection.thinking_level)
  ) {
    throw new RuntimeError("invalid_request", "Unknown thinking level.", 400);
  }
  if (connection.media_adapter && connection.media_adapter !== "qwen-omni") {
    throw new RuntimeError("video_connection_unsupported", "未知的音画适配器", 400);
  }
  if (connection.media_adapter && connection.provider !== "openai-compatible") {
    throw new RuntimeError("video_connection_unsupported", "该连接不支持音画联合问答", 400);
  }
  // 内置目录（Anthropic / DeepSeek）里的模型自带窗口与输出上限，不必用户填；目录外的按自定义模型校验。
  if (connection.provider === "anthropic" || connection.provider === "deepseek") {
    if (!catalogModel(connection.provider, connection.model)) validateMetadata(connection);
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
  // OpenCode：base_url 可省略（缺省 Zen 端点）；模型不在 Pi 内置目录，窗口与输出上限仍需声明。
  if (connection.provider === "opencode") {
    validateMetadata(connection);
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
  const known = catalogModel(providerId, connection.model);
  const metadata = known
    ? {
        contextWindow: known.contextWindow,
        maxTokens: known.maxTokens,
      }
    : validateMetadata(connection);
  const baseUrl =
    connection.base_url?.trim() ||
    known?.baseUrl ||
    (providerId === "deepseek"
      ? "https://api.deepseek.com"
      : providerId === "opencode"
        ? OPENCODE_DEFAULT_BASE
        : "https://api.anthropic.com");
  const api =
    providerId === "anthropic"
      ? ("anthropic-messages" as const)
      : ("openai-completions" as const);
  const model: Model<typeof api> = {
    ...(known ?? {}),
    id: connection.model,
    name: known?.name ?? connection.model,
    api,
    provider: providerId,
    baseUrl,
    // 非目录模型没有能力元数据：只有用户选了非关闭档位时才声明推理能力（SDD 00 §4）。
    // 声明即会下发 thinking 参数，未选档位时保持沉默，避免给未知端点发送它不认识的字段。
    reasoning: known?.reasoning ?? (connection.thinking_level !== undefined && connection.thinking_level !== "off"),
    // 非内置目录模型：按连接声明的视觉能力补 "image"（否则工具结果里的图会被 pi-ai 静默丢弃）。
    // 用户显式声明可看图时不接受本地目录的 text-only（目录滞后会静默把图降级成占位文本）。
    // 目录已含 image 时保持原样；否则在文本基础上补 image（SDD 00 D-023）。
    input: connection.vision
      ? Array.from(new Set([...(known?.input ?? ["text"]), "image" as const]))
      : (known?.input ?? ["text"]),
    cost: known?.cost ?? ZERO_COST,
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
      ? {
          stream: withOpencodeSession(anthropicStream),
          streamSimple: withOpencodeSession(anthropicStreamSimple),
        }
      : {
          stream: withOpencodeSession(videoMedia ? qwenStream : openAICompletionsStream),
          streamSimple: withOpencodeSession(videoMedia ? qwenStreamSimple : openAICompletionsStreamSimple),
        };
  const provider = createProvider({
    id: providerId,
    name:
      providerId === "anthropic"
        ? "Anthropic"
        : providerId === "deepseek"
          ? "DeepSeek"
          : providerId === "opencode"
            ? "OpenCode"
            : "OpenAI Compatible",
    baseUrl,
    auth: {
      apiKey: {
        name: `${providerId} API key`,
        resolve: async ({ ctx }) => {
          // 内置目录的两家：密钥可来自连接，也可来自环境变量；兼容端点只认连接里填的。
          const envName =
            providerId === "anthropic"
              ? "ANTHROPIC_API_KEY"
              : providerId === "deepseek"
                ? "DEEPSEEK_API_KEY"
                : undefined;
          const apiKey = credential ?? (envName ? await ctx.env(envName) : undefined);
          if (envName && !apiKey) return undefined;
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
