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
  disposeCredential(): void;
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
  const streams: ProviderStreams =
    providerId === "anthropic"
      ? { stream: anthropicStream, streamSimple: anthropicStreamSimple }
      : {
          stream: openAICompletionsStream,
          streamSimple: openAICompletionsStreamSimple,
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
    disposeCredential() {
      credential = undefined;
    },
  };
}
