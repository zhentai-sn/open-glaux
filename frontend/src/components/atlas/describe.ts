// 描述生成编排（SDD feats/03 §6.1 后半段）：前端取裁剪图 → runtime /atlas/describe（凭据只到 runtime）
// → backend PUT /exemplars/{id}/description 写回。失败不改 backend（保持 pending，页面可重试）。
import { atlasApi, fetchCropBase64, type Exemplar } from "../../api/atlas";
import { agentRuntimeApi } from "../../agent/runtime/client";
import { toConnectionInput } from "../../agent/useConversation";
import type { Connection } from "../../store/session";

export function connectionUsable(connection: Connection): boolean {
  return Boolean(connection.model.trim());
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
