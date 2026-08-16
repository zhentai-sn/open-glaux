import type {
  AtlasDescribeInput,
  AtlasDescribeResult,
  ConnectionModelListResult,
  ConnectionProbeInput,
  ConnectionTestResult,
  PermissionMode,
  RuntimeHealth,
  SessionListItem,
  SessionStatus,
  SessionView,
  TransportCommand,
} from "./types";

const BASE = "/agent-api/v1";

export class AgentRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  expectBody = true,
): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let code = "runtime_unavailable";
    let message = `Agent Runtime returned ${response.status}.`;
    let traceId: string | undefined;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; trace_id?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      traceId = body.error?.trace_id;
    } catch {
      // Keep the safe generic message for malformed error responses.
    }
    throw new AgentRuntimeError(response.status, code, message, traceId);
  }
  return (expectBody ? response.json() : undefined) as Promise<T>;
}

export const agentRuntimeApi = {
  health: () => request<RuntimeHealth>("/health"),
  listSessions: (status?: SessionStatus) =>
    request<SessionListItem[]>(
      `/sessions${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createSession: (
    sessionId: string,
    options?: { title?: string; permission_mode?: PermissionMode },
  ) =>
    request<SessionView>("/sessions", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, ...options }),
    }),
  getSession: (sessionId: string) =>
    request<SessionView>(`/sessions/${encodeURIComponent(sessionId)}`),
  patchSession: (
    sessionId: string,
    patch: Partial<
      Pick<
        SessionView,
        "title" | "status" | "permission_mode" | "provider" | "model"
      >
    >,
  ) =>
    request<SessionView>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteSession: (sessionId: string) =>
    request<void>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      false,
    ),
  command: (sessionId: string, command: TransportCommand) =>
    request<SessionView>(
      `/sessions/${encodeURIComponent(sessionId)}/commands`,
      {
        method: "POST",
        body: JSON.stringify(command),
      },
    ),
  // 连接探测（退役 orchestration P2：从 backend /intent/vlm/* 迁来，agent-runtime 是唯一模型出口）
  testConnection: (input: ConnectionProbeInput) =>
    request<ConnectionTestResult>("/connection/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listModels: (input: ConnectionProbeInput) =>
    request<ConnectionModelListResult>("/connection/models", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // 图谱描述生成（SDD feats/03 §6.1）：凭据只发 runtime，不经 backend；结果由前端写回 backend。
  atlasDescribe: (input: AtlasDescribeInput) =>
    request<AtlasDescribeResult>("/atlas/describe", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export type AgentRuntimeClient = typeof agentRuntimeApi;
