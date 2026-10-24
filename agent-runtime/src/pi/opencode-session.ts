/**
 * OpenCode（`opencode.ai` 的 Go / Zen 端点）自 2026-09-06 起强制要求 `x-opencode-session`：
 * 缺失时返回 `400 MissingSessionID`，值用于提示缓存路由，必须**同一会话稳定、不同会话互不相同**。
 *
 * 只在 host 精确等于 `opencode.ai`（https、忽略结尾点）时补头，避免把会话标识发给第三方兼容端点
 * 或 `opencode.ai.example` 这类仿冒主机；调用方已显式配置该头时原样保留。
 */

import type { Model, ProviderHeaders, StreamOptions } from "@earendil-works/pi-ai";

const OPENCODE_HOST = "opencode.ai";
const SESSION_HEADER = "x-opencode-session";

/** 是否为 OpenCode 托管端点（Go / Zen）。 */
export function isOpencodeEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.replace(/\.$/u, "").toLowerCase() === OPENCODE_HOST;
}

function hasSessionHeader(headers: ProviderHeaders | Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some((name) => name.toLowerCase() === SESSION_HEADER);
}

/**
 * 需要补头时返回带该头的新对象；否则返回入参 `options.headers` 本身（引用相等），
 * 调用方据此判断是否需要替换 options。
 */
export function resolveOpencodeSessionHeaders(
  model: Pick<Model<string>, "baseUrl" | "headers">,
  options?: Pick<StreamOptions, "sessionId" | "headers">,
): ProviderHeaders | undefined {
  const current = options?.headers;
  // 没有会话标识时不臆造共享会话：宁可让上游报错，也不把不同对话并到同一个缓存路由。
  if (!options?.sessionId || !isOpencodeEndpoint(model.baseUrl)) return current;
  if (hasSessionHeader(model.headers) || hasSessionHeader(current)) return current;
  return { ...current, [SESSION_HEADER]: options.sessionId };
}
