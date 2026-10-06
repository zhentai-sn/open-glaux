import { useMemo } from "react";

import type { Annotation, Index, Modality, ObjectMeta } from "../../api/types";
import { confirmSuggestion, resolveSuggestion } from "../../annotation/bridge";
import { openObject } from "../../data/actions";
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
// store 只装焦点对象的标注：卡片所属对象不在舞台上时查不到不代表已删除，显示"在其他对象上"
// 并给出打开入口（模态取对象清单，退而取 payload.modality）；焦点就是该对象而 store 里
// 查不到时，才以"已不存在"降级展示。

export const ANNOTATION_PROPOSED_KIND = "glaux.annotation_proposed";

export interface AnnotationProposedPayload {
  annotation_id: string | null;
  image_id: string;
  /** 所属对象的模态；旧快照没有此字段。 */
  modality?: Modality;
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
    ...(typeof p.modality === "string" && p.modality ? { modality: p.modality } : {}),
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
  const focusedId = useSession((s) => s.focus?.object_id ?? null);
  // 优先用已加载的对象清单；旧快照不带 modality 时只能靠它
  const objectModality = useSession((s) => modalityOf(s.objects, payload.image_id)) ?? payload.modality ?? null;
  const uiMode = useSession((s) => s.uiMode);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const live = useMemo(
    () => (payload.annotation_id ? annotations.find((a) => a.id === payload.annotation_id) : undefined),
    [annotations, payload.annotation_id],
  );

  // 本次调用没提出任何标注（没开图 / 几何缺失或退化）——不渲染建议卡片，避免出现一张
  // 点不动的空卡；模型收到的文字里已说明原因。
  if (!payload.annotation_id) return null;

  // image_id 缺省（旧快照）时无从判断归属，按焦点对象处理
  const onStage = !payload.image_id || payload.image_id === focusedId;
  const status: CardStatus = live ? live.status : onStage ? "missing" : "elsewhere";
  const pending = status === "suggested";

  const reveal = async () => {
    await openObject(payload.image_id, objectModality ?? undefined);
    if (uiMode === "focus") setFocusLayout({ rightOpen: true, sideView: "stage" });
  };

  return (
    <div className={`suggestion-card ${status}`} data-testid="suggestion-card">
      <div className="suggestion-head">
        <span className="suggestion-icon" aria-hidden="true"><Icon icon={ICONS.annotation} size="sm" /></span>
        <div className="suggestion-title">
          <small>{t("suggestion_kind")}</small>
          <b>{payload.label}</b>
        </div>
        <StatusBadge status={status} />
      </div>
      {payload.note && <div className="suggestion-note">{payload.note}</div>}
      {pending && live && (
        <div className="suggestion-actions">
          <button
            type="button"
            className="interaction-btn primary"
            data-testid="suggestion-confirm"
            onClick={() => void confirmSuggestion(live)}
          >
            {t("suggestion_confirm")}
          </button>
          <button
            type="button"
            className="interaction-btn"
            data-testid="suggestion-reject"
            onClick={() => void resolveSuggestion(live.id, live.seq, "rejected")}
          >
            {t("suggestion_reject")}
          </button>
        </div>
      )}
      {status === "elsewhere" && objectModality && (
        <div className="suggestion-actions">
          <button
            type="button"
            className="interaction-btn"
            data-testid="suggestion-open-object"
            onClick={() => void reveal()}
          >
            {t("objcard_open_stage")}
          </button>
        </div>
      )}
    </div>
  );
}

type CardStatus = Annotation["status"] | "missing" | "elsewhere";

/** 卡片所属对象已在对象清单里时返回其模态，否则 null。 */
function modalityOf(objects: Record<string, ObjectMeta[]>, id: string): Modality | null {
  if (!id) return null;
  for (const list of Object.values(objects)) {
    const hit = list.find((o) => o.id === id);
    if (hit) return hit.modality;
  }
  return null;
}

function StatusBadge({ status }: { status: CardStatus }) {
  const { t } = useI18n();
  const key: Record<typeof status, I18nKey> = {
    suggested: "suggestion_state_pending",
    confirmed: "suggestion_state_confirmed",
    rejected: "suggestion_state_rejected",
    draft: "suggestion_state_pending",
    missing: "suggestion_state_missing",
    elsewhere: "suggestion_state_elsewhere",
  };
  return (
    <span className={`suggestion-badge ${status}`} data-testid="suggestion-badge">
      {t(key[status])}
    </span>
  );
}
