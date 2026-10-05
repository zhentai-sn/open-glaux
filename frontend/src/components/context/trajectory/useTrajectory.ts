import { useCallback, useEffect, useState } from "react";

import { agentRuntimeApi, AgentRuntimeError } from "../../../agent/runtime/client";
import type { Trajectory } from "../../../agent/runtime/types";
import { useAgentSessions } from "../../../store/agentSessions";
import { errorText } from "../shared";

export type TrajectoryState =
  | { status: "no-session" }
  | { status: "loading"; data?: Trajectory }
  | { status: "ready"; data: Trajectory }
  | { status: "error"; error: string }
  | { status: "outdated" };

/** 响应是否为 SDD 21 §9.3 的结构；runtime 仍是旧进程时路由不存在或结构不同。 */
function isTrajectory(data: unknown): data is Trajectory {
  const value = data as Partial<Trajectory> | null;
  return !!value && Array.isArray(value.turns) && typeof value.headers === "object" && value.headers !== null
    && typeof value.totals === "object" && value.totals !== null;
}

/**
 * 当前会话的运行轨迹（SDD 21 §7.7）：进入分区与切换会话时请求；会话阶段变化时重取
 * （阶段随 `run.settled`、`context.compacted` 触发的快照更新）。刷新期间保留旧结果。
 */
export function useTrajectory() {
  const sessionId = useAgentSessions((state) => state.currentSessionId);
  const phase = useAgentSessions((state) => (state.currentSessionId ? state.views[state.currentSessionId]?.phase : undefined));
  const [state, setState] = useState<TrajectoryState>({ status: "no-session" });

  const refresh = useCallback(async () => {
    if (!sessionId) return setState({ status: "no-session" });
    setState((prev) => ({ status: "loading", ...(prev.status === "ready" || prev.status === "loading" ? { data: prev.data } : {}) }));
    try {
      const data = await agentRuntimeApi.getTrajectory(sessionId);
      setState(isTrajectory(data) ? { status: "ready", data } : { status: "outdated" });
    } catch (err) {
      // 旧版 runtime 没有该路由，回 404 not_found（区别于 session_not_found），按「版本旧」提示
      setState(err instanceof AgentRuntimeError && err.code === "not_found" ? { status: "outdated" } : { status: "error", error: errorText(err) });
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, phase]);

  return { state, refresh, sessionId };
}
