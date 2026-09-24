import { useMemo } from "react";

import type { Annotation, Index } from "../../api/types";
import { resolveSuggestion } from "../../annotation/bridge";
import { useI18n } from "../../i18n";
import type { I18nKey } from "../../i18n/en";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 会话中的"建议标注"卡片（SDD 02 §6 / §7.3）：渲染 `propose_annotation` 工具结果的
// details payload，给出确认 / 驳回两个动作。这是"绝不自动确认"那条非目标的用户侧落点——
// agent 只能提出，转正与否永远是人点的。
//
// 卡片状态取自 store 里那条标注的实时 status（不是 payload 里的快照）：同一条建议
// 可能已在画布上被确认过，会话回看时必须显示它现在的样子，而不是刚提出时的样子。
// 标注被硬删除后 store 里查不到 → 以"已不存在"降级展示，与 AtlasRefCard 的做法一致。

export const ANNOTATION_PROPOSED_KIND = "glaux.annotation_proposed";

export interface AnnotationProposedPayload {
  annotation_id: string | null;
  image_id: string;
  label: string;
  note?: string;
  reason?: string;
  index?: Index;
  seq?: number;
}

/** 从工具结果 details 解析 payload；形状不符返回 null。 */
export function parseAnnotationProposed(value: unknown): AnnotationProposedPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const p = (
    v.kind === ANNOTATION_PROPOSED_KIND && v.payload && typeof v.payload === "object" ? v.payload : v
  ) as Record<string, unknown>;
  if (!("annotation_id" in p) || typeof p.label !== "string") return null;
  const id = p.annotation_id;
  if (id !== null && typeof id !== "string") return null;
  return {
    annotation_id: id,
    image_id: typeof p.image_id === "string" ? p.image_id : "",
    label: p.label,
    ...(typeof p.note === "string" ? { note: p.note } : {}),
    ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
    ...(p.index && typeof p.index === "object" && !Array.isArray(p.index) ? { index: p.index as Index } : {}),
    ...(typeof p.seq === "number" ? { seq: p.seq } : {}),
  };
}

export function SuggestionCard({ payload }: { payload: AnnotationProposedPayload }) {
  const { t } = useI18n();
  const annotations = useSession((s) => s.annotations);
  const live = useMemo(
    () => (payload.annotation_id ? annotations.find((a) => a.id === payload.annotation_id) : undefined),
    [annotations, payload.annotation_id],
  );

  // 本次调用没提出任何标注（没开图 / 几何缺失或退化）——不渲染建议卡片，避免出现一张
  // 点不动的空卡；模型收到的文字里已说明原因。
  if (!payload.annotation_id) return null;

  const status: Annotation["status"] | "missing" = live ? live.status : "missing";
  const pending = status === "suggested";

  return (
    <div className={"suggestion-card" + (pending ? " pending" : "")} data-testid="suggestion-card">
      <div className="suggestion-head">
        <Icon icon={ICONS.annotation} size="sm" />
        <b>{t("suggestion_title", { label: payload.label })}</b>
        <StatusBadge status={status} />
      </div>
      {payload.note && <div className="suggestion-note">{payload.note}</div>}
      {pending && live && (
        <div className="suggestion-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="suggestion-confirm"
            onClick={() => void resolveSuggestion(live.id, live.seq, "confirmed")}
          >
            {t("suggestion_confirm")}
          </button>
          <button
            type="button"
            data-testid="suggestion-reject"
            onClick={() => void resolveSuggestion(live.id, live.seq, "rejected")}
          >
            {t("suggestion_reject")}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Annotation["status"] | "missing" }) {
  const { t } = useI18n();
  const key: Record<typeof status, I18nKey> = {
    suggested: "suggestion_state_pending",
    confirmed: "suggestion_state_confirmed",
    rejected: "suggestion_state_rejected",
    draft: "suggestion_state_pending",
    missing: "suggestion_state_missing",
  };
  return (
    <span className={`suggestion-badge ${status}`} data-testid="suggestion-badge">
      {t(key[status])}
    </span>
  );
}
