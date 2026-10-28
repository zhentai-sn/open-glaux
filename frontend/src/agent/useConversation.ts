import { CHAT_EDITION } from "../edition";
import { useAgentSessions } from "../store/agentSessions";
import { taskViewFor } from "../data/actions";
import { activeObject, useSession, type Connection } from "../store/session";
import type { Invocation } from "../components/agent/slashCommands";
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

/** 前端枚举（下划线）→ runtime 枚举（连字符）；deepseek / anthropic / opencode 两侧同名。 */
export function runtimeProviderName(
  provider: Connection["provider"],
): "anthropic" | "openai-compatible" | "deepseek" | "opencode" {
  return provider === "openai_compatible" ? "openai-compatible" : provider;
}

/** 连接探测入参（测试连接 / 拉模型）——只带 provider / 端点 / 密钥，不带 model。 */
export function toProbeInput(connection: Connection): ConnectionProbeInput {
  return {
    provider: runtimeProviderName(connection.provider),
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
  if (connection.mediaAdapter === "qwen-omni") return true;
  // 只有探测明确说"不收图"才关闭；unknown 一律乐观放行（SDD 00 D-023）。
  // 依据 D-022：多数兼容端点的 /models 不含视觉字段，据 unknown 关闭会把大量可用模型
  // 误判成纯文本，连带 needs_vision 的工具全部不挂载；让 provider 返回明确错误更可诊断。
  const probe = connection.models?.find((model) => model.id === connection.model)?.vision;
  return probe !== "no";
}

export function toConnectionInput(
  connection: Connection,
  hasImages = false,
): ConnectionInput {
  return {
    vision: visionFor(connection, hasImages),
    provider: runtimeProviderName(connection.provider),
    model: connection.model,
    ...(connection.mediaAdapter === "qwen-omni" ? { media_adapter: "qwen-omni" as const } : {}),
    ...(connection.baseUrl ? { base_url: connection.baseUrl } : {}),
    ...(connection.contextWindow
      ? { context_window: connection.contextWindow }
      : {}),
    ...(connection.maxTokens ? { max_tokens: connection.maxTokens } : {}),
    ...(connection.apiKey ? { credential: connection.apiKey } : {}),
    ...(connection.thinkingLevel ? { thinking_level: connection.thinkingLevel } : {}),
  };
}

export function useConversation() {
  const connection = useSession((state) => state.connection);
  const sendPrompt = useAgentSessions((state) => state.sendPrompt);
  const regenerate = useAgentSessions((state) => state.regenerate);
  const abort = useAgentSessions((state) => state.abort);

  return {
    send: (content: string, images: PromptImage[] = [], invocation?: Invocation) =>
      sendPrompt(
        content,
        images,
        toConnectionInput(connection, images.length > 0),
        CHAT_EDITION ? undefined : toViewerContext(),
        invocation,
      ),
    // 重新生成会连原图一起重发（runtime 侧 regenerateLatest），所以视觉能力必须一并带上。
    regenerate: () => regenerate(toConnectionInput(connection, true), CHAT_EDITION ? undefined : toViewerContext()),
    abort,
  };
}
