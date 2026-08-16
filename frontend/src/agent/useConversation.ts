import { useAgentSessions } from "../store/agentSessions";
import { useSession, type Connection } from "../store/session";
import type {
  ConnectionInput,
  ConnectionProbeInput,
  ViewerContext,
} from "./runtime/types";

/**
 * 查看器当前上下文（随 prompt 下发给 agent-runtime，`run_task` 工具据此缺省取当前图 / 当前任务）。
 * 按模态取活动对象：CT → activeVolume；病理 → activeSlide（附 ROI）；其它 → activeImage（附 cf）。
 */
export function toViewerContext(): ViewerContext {
  const s = useSession.getState();
  const task = s.tasks.find((t) => t.modality === s.modality)?.task;
  const out: ViewerContext = { modality: s.modality };
  if (task) out.task = task;
  if (s.activeModel) out.method = s.activeModel;
  if (s.modality === "ct_abdomen") {
    if (s.activeVolume) out.image_id = s.activeVolume;
  } else if (s.modality === "pathology") {
    if (s.activeSlide) out.image_id = s.activeSlide;
    if (s.wsiRoi) out.roi_box = s.wsiRoi;
  } else {
    if (s.activeImage) out.image_id = s.activeImage;
    const cf = s.imageMeta?.cf;
    if (typeof cf === "number") out.cubs_cf = cf;
  }
  return out;
}

/** 连接探测入参（测试连接 / 拉模型）——只带 provider / 端点 / 密钥，不带 model。 */
export function toProbeInput(connection: Connection): ConnectionProbeInput {
  return {
    provider:
      connection.provider === "openai_compatible"
        ? "openai-compatible"
        : "anthropic",
    ...(connection.baseUrl ? { base_url: connection.baseUrl } : {}),
    ...(connection.apiKey ? { credential: connection.apiKey } : {}),
  };
}

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
    send: (content: string) =>
      sendPrompt(content, toConnectionInput(connection), toViewerContext()),
    regenerate: () => regenerate(toConnectionInput(connection)),
    abort,
  };
}
