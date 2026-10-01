// 描述生成编排（SDD feats/03 §6.1）：前端取裁剪图 → runtime /atlas/describe（凭据只到 runtime）
// → backend PUT /exemplars/{id}/description 写回。失败不改 backend（保持 pending，可重试）。
// 每次调用前须经用户确认（D-28）：本模块只在调用方已取得确认后执行，自身不做任何自动触发。
import { atlasApi, fetchCropBase64, type Exemplar } from "../../api/atlas";
import { agentRuntimeApi } from "../../agent/runtime/client";
import { toConnectionInput } from "../../agent/useConversation";
import { useAtlasUi } from "../../store/atlas";
import { useSession, type Connection } from "../../store/session";

const CONCURRENCY = 2;
const DEFAULT_HOST: Record<Connection["provider"], string> = {
  anthropic: "api.anthropic.com",
  openai_compatible: "",
};

/** 已选模型且未被探测为不支持图像（探测未知时按可用处理，失败由描述错误兜底）。 */
export function connectionUsable(connection: Connection): boolean {
  const model = connection.model.trim();
  if (!model) return false;
  return connection.models?.find((m) => m.id === model)?.vision !== "no";
}

/** 确认文案里的发送目标「模型 · host」（D-28：写明图发往哪里）。 */
export function connectionTarget(connection: Connection): string {
  let host = DEFAULT_HOST[connection.provider] ?? "";
  if (connection.baseUrl.trim()) {
    try {
      host = new URL(connection.baseUrl.trim()).host;
    } catch {
      host = connection.baseUrl.trim();
    }
  }
  return [connection.model.trim(), host].filter(Boolean).join(" · ");
}

/** 用案例的标签/图注拼一个提示词提示（不改变模板字段，只帮模型定位场景）。 */
export function hintFor(ex: Pick<Exemplar, "tags_raw" | "caption">): string {
  const parts: string[] = [];
  if (ex.tags_raw.length) parts.push(`tags: ${ex.tags_raw.join(", ")}`);
  if (ex.caption) parts.push(`caption: ${ex.caption}`);
  return parts.join("\n");
}

export async function describeExemplar(ex: Exemplar, connection: Connection): Promise<Exemplar> {
  const image_base64 = await fetchCropBase64(ex.exemplar_id);
  const res = await agentRuntimeApi.atlasDescribe({
    image_base64,
    mime_type: "image/png",
    hint: hintFor(ex),
    connection: toConnectionInput(connection),
  });
  return atlasApi.setDescription(ex.exemplar_id, res.description, "done");
}

/**
 * 用户确认后对一组案例生成描述（§6.1 描述队列）：并发 2、单条失败自动重试 1 次；
 * 进度写 useAtlasUi.describeJob。确认绑定在当时的连接上：中途切换连接即停止，剩余案例保持待描述。
 */
export async function runDescribeQueue(ids: string[], connection: Connection): Promise<void> {
  const ui = useAtlasUi.getState();
  if (ui.describeJob?.running || ids.length === 0) return;
  const job = { total: ids.length, done: 0, ok: 0, failed: 0, running: true };
  ui.setDescribeJob({ ...job });
  const queue = [...ids];
  const stillConfirmed = () => useSession.getState().connection === connection;

  const one = async (id: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ex = await atlasApi.get(id);
        if (ex.describe_status !== "done") await describeExemplar(ex, connection);
        return true;
      } catch {
        if (!stillConfirmed()) return false;
      }
    }
    return false;
  };

  const worker = async () => {
    while (queue.length && stillConfirmed()) {
      const id = queue.shift()!;
      const ok = await one(id);
      job.done += 1;
      if (ok) job.ok += 1;
      else job.failed += 1;
      useAtlasUi.getState().setDescribeJob({ ...job });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  job.failed += queue.length; // 切换连接后未执行的，保持待描述
  job.done += queue.length;
  useAtlasUi.getState().setDescribeJob({ ...job, running: false });
  useAtlasUi.getState().bumpRefresh();
}
