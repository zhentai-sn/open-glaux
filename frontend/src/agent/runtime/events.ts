import type { SessionView, TransportEvent } from "./types";

export interface EventHandlers {
  onSnapshot: (snapshot: SessionView) => void;
  onPiEvent: (
    event: Extract<TransportEvent, { event: "pi.event" }>["data"],
  ) => void;
  onAdapterError: (
    error: Extract<TransportEvent, { event: "adapter.error" }>["data"],
  ) => void;
  onVideoAnswer?: (event: Extract<TransportEvent, { event: "video.answer" }>["data"]) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export type EventConnector = (
  sessionId: string,
  handlers: EventHandlers,
) => () => void;

export const connectSessionEvents: EventConnector = (sessionId, handlers) => {
  const source = new EventSource(
    `/agent-api/v1/sessions/${encodeURIComponent(sessionId)}/events`,
  );
  source.onopen = () => handlers.onConnectionChange?.(true);
  source.onerror = () => handlers.onConnectionChange?.(false);
  source.addEventListener("snapshot", (event) => {
    handlers.onSnapshot(JSON.parse((event as MessageEvent<string>).data) as SessionView);
  });
  source.addEventListener("pi.event", (event) => {
    handlers.onPiEvent(
      JSON.parse((event as MessageEvent<string>).data) as Extract<
        TransportEvent,
        { event: "pi.event" }
      >["data"],
    );
  });
  source.addEventListener("video.answer", (event) => {
    handlers.onVideoAnswer?.(JSON.parse((event as MessageEvent<string>).data) as Extract<TransportEvent, { event: "video.answer" }>["data"]);
  });
  source.addEventListener("adapter.error", (event) => {
    handlers.onAdapterError(
      JSON.parse((event as MessageEvent<string>).data) as Extract<
        TransportEvent,
        { event: "adapter.error" }
      >["data"],
    );
  });
  return () => source.close();
};

export function messageRole(message: unknown): "user" | "assistant" | null {
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant" ? role : null;
}

export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const value = block as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string"
        ? [value.text]
        : [];
    })
    .join("\n");
}

export interface MessageImage {
  /** 直接可用于 <img src>；由 pi-ai `ImageContent {data, mimeType}` 拼出。 */
  dataUrl: string;
  mimeType: string;
}

/**
 * 消息里的图像块（SDD 00 D-021）——用户贴的图随 transcript 持久化，刷新后仍要能回显。
 */
export function messageImages(message: unknown): MessageImage[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; data?: unknown; mimeType?: unknown };
    if (value.type !== "image" || typeof value.data !== "string") return [];
    const mimeType = typeof value.mimeType === "string" ? value.mimeType : "image/png";
    return [{ dataUrl: `data:${mimeType};base64,${value.data}`, mimeType }];
  });
}

export interface MessageToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** assistant 消息里的工具调用块（pi-ai `toolCall` content）；无则空数组。 */
export function messageToolCalls(message: unknown): MessageToolCall[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
    if (value.type !== "toolCall" || typeof value.name !== "string") return [];
    return [
      {
        id: typeof value.id === "string" ? value.id : "",
        name: value.name,
        arguments:
          value.arguments && typeof value.arguments === "object"
            ? (value.arguments as Record<string, unknown>)
            : {},
      },
    ];
  });
}

/**
 * `toolResult` 消息里的图谱引用产物（SDD 03 §12 / D-21）——runtime 侧 `consult_atlas` 把
 * `details = {kind, payload}` 写进 transcript，会话视图保留该条消息（content 已剥空），
 * 卡片因此刷新后仍在。返回原始 details，交由 `parseAtlasReferenced` 校形。
 */
export function messageToolResultDetails(message: unknown): unknown {
  if (!message || typeof message !== "object") return null;
  const m = message as { role?: unknown; isError?: unknown; details?: unknown };
  if (m.role !== "toolResult" || m.isError) return null;
  return m.details ?? null;
}

export function piEventType(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}
