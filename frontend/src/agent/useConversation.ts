import { useAgentSessions } from "../store/agentSessions";
import { useSession, type Connection } from "../store/session";
import type { ConnectionInput } from "./runtime/types";

export function toConnectionInput(connection: Connection): ConnectionInput {
  return {
    provider:
      connection.provider === "openai_compatible"
        ? "openai-compatible"
        : "anthropic",
    model: connection.model,
    ...(connection.baseUrl ? { base_url: connection.baseUrl } : {}),
    ...(connection.contextWindow
      ? { context_window: connection.contextWindow }
      : {}),
    ...(connection.maxTokens ? { max_tokens: connection.maxTokens } : {}),
    ...(connection.apiKey ? { credential: connection.apiKey } : {}),
  };
}

export function useConversation() {
  const connection = useSession((state) => state.connection);
  const sendPrompt = useAgentSessions((state) => state.sendPrompt);
  const regenerate = useAgentSessions((state) => state.regenerate);
  const abort = useAgentSessions((state) => state.abort);

  return {
    send: (content: string) => sendPrompt(content, toConnectionInput(connection)),
    regenerate: () => regenerate(toConnectionInput(connection)),
    abort,
  };
}
