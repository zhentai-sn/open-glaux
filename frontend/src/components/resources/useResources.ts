import { useCallback, useEffect, useState } from "react";

import { agentRuntimeApi, AgentRuntimeError } from "../../agent/runtime/client";
import type { ResourceList } from "../../agent/runtime/types";
import { useAgentSessions } from "../../store/agentSessions";

/** 当前会话绑定的项目；「技能」「提示词」页的项目级内容随它变化（SDD 17 §7.6 规则 2）。 */
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
