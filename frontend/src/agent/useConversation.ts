import { CHAT_EDITION } from "../edition";
import { useAgentSessions } from "../store/agentSessions";
import { useSession, type Connection } from "../store/session";
import type {
  ConnectionInput,
  ConnectionProbeInput,
  PromptImage,
  ViewerContext,
} from "./runtime/types";

/**
 * 查看器当前上下文（随 prompt 下发给 agent-runtime，`run_task` 工具据此缺省取当前图 / 当前任务）。
 * 按模态取活动对象：CT → activeVolume；病理 → activeSlide（附 ROI）；其它 → activeImage（附 cf）。
 */
export function toViewerContext(): ViewerContext {
  const s = useSession.getState();
  const out: ViewerContext = { modality: s.modality };
  // SDD 07：自然图像不是 science-core 任务。只给 Agent 当前图，不泄漏上一个医学任务、
  // 活动模型或标定，否则模型可能错误选择 run_task 而不是 segment_region。
  if (s.modality === "natural_image") {
    if (s.activeImage) out.image_id = s.activeImage;
    return out;
  }
  const task = s.tasks.find((t) => t.modality === s.modality)?.task;
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
