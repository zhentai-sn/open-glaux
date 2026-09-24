import { CHAT_EDITION } from "../edition";
import { useAgentSessions } from "../store/agentSessions";
import { taskViewFor } from "../data/actions";
import { activeObject, useSession, type Connection } from "../store/session";
import type {
  ConnectionInput,
  ConnectionProbeInput,
  PromptImage,
  ViewerContext,
} from "./runtime/types";

/**
 * 查看器当前上下文（随 prompt 下发给 agent-runtime，`run_task` 工具据此缺省取当前对象 / 当前任务）。
 * 单一投影，不按模态分支（SDD 10 §7 规则 20）：无 TaskView 的对象不带 task / method，
 * 故通用图像、视频不会泄漏上一个任务、活动模型或标定（SDD 07）。
 */
export function toViewerContext(): ViewerContext {
  const s = useSession.getState();
  const out: ViewerContext = {};
  if (s.modality) {
    out.collection = s.modality;
  }
  const obj = activeObject(s);
  const tv = taskViewFor(s, obj) ?? (obj ? undefined : s.tasks.find((t) => t.modality === s.modality));
  if (tv) {
    out.task = tv.task;
    if (s.activeModel) out.method = s.activeModel;
  }
  if (!obj || !s.focus) return out;
  out.object = { id: obj.id, kind: obj.kind, axes: obj.axes, calibration: obj.calibration };
  out.focus = s.focus;
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

/**
 * 这次请求是否要把模型当视觉模型用。
 *
 * 带图发送时恒为 `true`：用户显式贴了图，意图明确；若模型确实不支持，让 provider 回一个
 * 明确错误，远好过 pi-ai 在本地把图换成"(image omitted)"占位符后照常作答——后者表现为
 * "模型胡说八道"，无从诊断。不带图时按探测结论走（影响工具结果里的图像）。
 */
function visionFor(connection: Connection, hasImages: boolean): boolean {
  if (hasImages) return true;
  return (
    connection.models?.find((model) => model.id === connection.model)?.vision ===
    "yes"
  );
}

export function toConnectionInput(
  connection: Connection,
  hasImages = false,
): ConnectionInput {
  return {
    vision: visionFor(connection, hasImages),
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
    send: (content: string, images: PromptImage[] = []) =>
      sendPrompt(
        content,
        images,
        toConnectionInput(connection, images.length > 0),
        CHAT_EDITION ? undefined : toViewerContext(),
      ),
    // 重新生成会连原图一起重发（runtime 侧 regenerateLatest），所以视觉能力必须一并带上。
    regenerate: () => regenerate(toConnectionInput(connection, true)),
    abort,
  };
}
