import type { SessionView, TransportEvent } from "./types";

export interface EventHandlers {
  onSnapshot: (snapshot: SessionView) => void;
  onPiEvent: (
    event: Extract<TransportEvent, { event: "pi.event" }>["data"],
  ) => void;
  onAdapterError: (
    error: Extract<TransportEvent, { event: "adapter.error" }>["data"],
  ) => void;
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

export function piEventType(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}
