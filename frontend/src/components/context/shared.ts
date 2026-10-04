import { useCallback, useEffect, useRef, useState } from "react";

import { agentRuntimeApi, AgentRuntimeError } from "../../agent/runtime/client";
import type { ResourceList, SystemPromptPreview } from "../../agent/runtime/types";
import { toConnectionInput, toViewerContext } from "../../agent/useConversation";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";

/** 资源名称规则（SDD 17 §7.5 规则 2）。 */
export const RESOURCE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** 当前会话绑定的项目；项目级内容随它变化（SDD 19 §7.2 规则 5）。 */
export function useCurrentProjectId(): string | null {
  return useAgentSessions((state) => {
    const id = state.currentSessionId;
    if (!id) return null;
    return state.views[id]?.project_id ?? state.sessions.find((s) => s.session_id === id)?.project_id ?? null;
  });
}

export function errorText(error: unknown): string {
  return error instanceof AgentRuntimeError ? `${error.code}: ${error.message}` : String(error);
}

/** 资源清单：随项目变化重新拉取，`reload` 供保存、删除后刷新。 */
export function useResourceList(projectId: string | null) {
  const [list, setList] = useState<ResourceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setList(await agentRuntimeApi.listResources(projectId));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { list, error, reload };
}

export type PreviewState =
  | { status: "no-session" }
  | { status: "no-model" }
  | { status: "loading"; data?: SystemPromptPreview }
  | { status: "ready"; data: SystemPromptPreview; stale: boolean }
  | { status: "error"; error: string };

/**
 * 系统提示词预览（SDD 19 §7.4）：进入「系统提示词」「工具」分区或切换会话时自动请求；
 * 结果是快照，资源改动后只标记「已变化」，由用户刷新。
 */
export function usePreview(active: boolean) {
  const sessionId = useAgentSessions((state) => state.currentSessionId);
  const connection = useSession((state) => state.connection);
  const hasModel = !!connection.model.trim();
  // 连接对象可能频繁换引用；自动重取只跟会话与「是否有模型」，请求时读最新连接
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [state, setState] = useState<PreviewState>({ status: "no-session" });

  const refresh = useCallback(async () => {
    if (!sessionId) return setState({ status: "no-session" });
    if (!hasModel) return setState({ status: "no-model" });
    setState((prev) => ({ status: "loading", ...(prev.status === "ready" ? { data: prev.data } : {}) }));
    try {
      const data = await agentRuntimeApi.previewSystemPrompt(sessionId, toConnectionInput(connectionRef.current), toViewerContext());
      setState({ status: "ready", data, stale: false });
    } catch (err) {
      setState({ status: "error", error: errorText(err) });
    }
  }, [sessionId, hasModel]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const markStale = useCallback(() => {
    setState((prev) => (prev.status === "ready" ? { ...prev, stale: true } : prev));
  }, []);

  return { state, refresh, markStale };
}

// ---- 离开前确认（SDD 19 §7.3 规则 2）----
// 编辑器各自登记未保存状态；切换分区、关闭上下文页前统一询问一次。
const dirtyEditors = new Set<string>();

export function setEditorDirty(key: string, dirty: boolean): void {
  if (dirty) dirtyEditors.add(key);
  else dirtyEditors.delete(key);
}

/** 有未保存修改时询问；用户确认放弃后清空登记。返回是否可以离开。 */
export function confirmLeave(message: string): boolean {
  if (!dirtyEditors.size) return true;
  if (!window.confirm(message)) return false;
  dirtyEditors.clear();
  return true;
}

/** 编辑器挂载期间把 `dirty` 同步到登记表，卸载时撤销。 */
export function useDirtyRegistration(key: string, dirty: boolean): void {
  useEffect(() => {
    setEditorDirty(key, dirty);
  }, [key, dirty]);
  useEffect(() => () => setEditorDirty(key, false), [key]);
}
