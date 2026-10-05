import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 智能体修订建议的记录卡片（SDD 22 §5.1）：放大复核后修改或撤回了自己的建议。
// 查看器里的几何由 toolBridge 同步；这里只留一条会话记录，不提供操作——
// 被修订的建议仍由原来那张建议卡片承载确认与驳回。

export const ANNOTATION_REVISED_KIND = "glaux.annotation_revised";

export interface AnnotationRevisedPayload {
  annotation_id: string;
  action: "update" | "withdraw";
  label?: string;
  note?: string;
}

/** 从工具结果 details 解析；未生效（带 reason）或形状不符返回 null。 */
export function parseAnnotationRevised(value: unknown): AnnotationRevisedPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== ANNOTATION_REVISED_KIND || typeof v.annotation_id !== "string") return null;
  if (v.action !== "update" && v.action !== "withdraw") return null;
  if (typeof v.reason === "string") return null;
  const annotation = v.annotation && typeof v.annotation === "object" ? (v.annotation as Record<string, unknown>) : undefined;
  return {
    annotation_id: v.annotation_id,
    action: v.action,
    ...(typeof annotation?.label === "string" && annotation.label ? { label: annotation.label } : {}),
    ...(typeof v.note === "string" && v.note ? { note: v.note } : {}),
  };
}

export function RevisionCard({ payload }: { payload: AnnotationRevisedPayload }) {
  const { t } = useI18n();
  return (
    <div className="suggestion-card missing" data-testid="revision-card">
      <div className="suggestion-head">
        <span className="suggestion-icon" aria-hidden="true"><Icon icon={ICONS.annotation} size="sm" /></span>
        <div className="suggestion-title">
          <small>{t(payload.action === "withdraw" ? "revision_withdrawn" : "revision_updated")}</small>
          <b>{payload.label ?? payload.annotation_id}</b>
        </div>
      </div>
      {payload.note && <div className="suggestion-note">{payload.note}</div>}
    </div>
  );
}
