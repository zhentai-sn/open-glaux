import type {
  AtlasDescribeInput,
  AtlasDescribeResult,
  ConnectionModelListResult,
  ConnectionProbeInput,
  ConnectionTestResult,
  InteractionReply,
  PermissionMode,
  PromptLang,
  RequestContext,
  ResourceList,
  ResourceSource,
  SkillItem,
  TemplateItem,
  InstructionsItem,
  ViewerContext,
  RuntimeHealth,
  SessionListItem,
  SessionStatus,
  SessionView,
  SystemPromptPreview,
  Trajectory,
  TransportCommand,
} from "./types";

const BASE = "/agent-api/v1";

function projectQuery(projectId: string | null): string {
  return projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
}

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
    options?: { title?: string; permission_mode?: PermissionMode; project_id?: string | null },
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
  // SDD 15 §9.4：回复权限审批或 ask_user 提问。
  replyInteraction: (sessionId: string, requestId: string, reply: InteractionReply) =>
    request<{ request_id: string; outcome: "answered" }>(
      `/sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(requestId)}`,
      { method: "POST", body: JSON.stringify(reply) },
    ),
  // SDD 17 §9.2：Skills、模板、自定义说明的管理与系统提示词预览。
  listResources: (projectId: string | null) => request<ResourceList>(`/resources${projectQuery(projectId)}`),
  getSkill: (source: ResourceSource, name: string, projectId: string | null) =>
    request<{ name: string; source: ResourceSource; path: string; content: string; editable: boolean }>(
      `/skills/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`,
    ),
  putSkill: (source: ResourceSource, name: string, content: string, projectId: string | null) =>
    request<{ item: SkillItem; diagnostics: unknown[] }>(`/skills/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deleteSkill: (source: ResourceSource, name: string, projectId: string | null) =>
    request<void>(`/skills/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`, { method: "DELETE" }, false),
  setSkillEnabled: (name: string, enabled: boolean) =>
    request<{ name: string; enabled: boolean }>(`/skills-enabled/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  getTemplate: (source: "user" | "project", name: string, projectId: string | null) =>
    request<{ name: string; source: string; path: string; content: string }>(`/prompts/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`),
  putTemplate: (source: "user" | "project", name: string, content: string, projectId: string | null) =>
    request<TemplateItem>(`/prompts/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deleteTemplate: (source: "user" | "project", name: string, projectId: string | null) =>
    request<void>(`/prompts/${source}/${encodeURIComponent(name)}${projectQuery(projectId)}`, { method: "DELETE" }, false),
  getInstructions: (scope: "user" | "project", projectId: string | null) =>
    request<{ scope: string; path: string; content: string }>(`/instructions/${scope}${projectQuery(projectId)}`),
  putInstructions: (scope: "user" | "project", content: string, projectId: string | null) =>
    request<InstructionsItem>(`/instructions/${scope}${projectQuery(projectId)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  // SDD 21 §9.3、§9.4：运行轨迹与单次请求上下文
  getTrajectory: (sessionId: string) => request<Trajectory>(`/sessions/${encodeURIComponent(sessionId)}/trajectory`),
  getRequestContext: (sessionId: string, itemId: string) =>
    request<RequestContext>(`/sessions/${encodeURIComponent(sessionId)}/trajectory/requests/${encodeURIComponent(itemId)}`),
  previewSystemPrompt: (sessionId: string, connection: ConnectionProbeInput | object, viewer?: ViewerContext, lang?: PromptLang) =>
    request<SystemPromptPreview>(`/sessions/${encodeURIComponent(sessionId)}/system-prompt`, {
      method: "POST",
      body: JSON.stringify({ connection, ...(viewer ? { viewer } : {}), ...(lang ? { lang } : {}) }),
    }),
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
