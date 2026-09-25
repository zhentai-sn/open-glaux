import type { ObjectKind } from "../../api/types";
import { openObject } from "../../data/actions";
import { useI18n } from "../../i18n";
import { useModalityLabel } from "../../i18n/modalityLabel";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 智能体 open_file 的结果卡片（SDD 13 §5.1、§7.3 规则 4）：智能体查看文件不改用户舞台，
// 由用户点「在舞台打开」决定是否切换焦点。卡片随会话快照持久呈现。
export const OBJECT_OPENED_KIND = "glaux.object_opened";

export interface ObjectOpenedPayload {
  id: string;
  kind: ObjectKind;
  modality: string;
  name: string;
  path: string;
}

/** 从工具结果 details 解析；形状不符返回 null。 */
export function parseObjectOpened(value: unknown): ObjectOpenedPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kind?: unknown; object?: unknown; path?: unknown };
  if (v.kind !== OBJECT_OPENED_KIND || !v.object || typeof v.object !== "object") return null;
  const o = v.object as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.kind !== "string" || typeof o.modality !== "string") return null;
  const path = typeof v.path === "string" ? v.path : "";
  const name = typeof o.display_name === "string" && o.display_name ? o.display_name : path || o.id;
  return { id: o.id, kind: o.kind as ObjectKind, modality: o.modality, name, path };
}

export function ObjectCard({ payload }: { payload: ObjectOpenedPayload }) {
  const { t } = useI18n();
  const label = useModalityLabel();
  const focused = useSession((s) => s.focus?.object_id === payload.id);
  const uiMode = useSession((s) => s.uiMode);
  const setFocusLayout = useSession((s) => s.setFocusLayout);

  const reveal = async () => {
    await openObject(payload.id, payload.modality);
    if (uiMode === "focus") setFocusLayout({ rightOpen: true, sideView: "stage" });
  };

  return (
    <div className="object-card" aria-label={t("objcard_label", { name: payload.name })}>
      <Icon icon={ICONS.file} size="md" />
      <div className="object-card-text">
        <span className="object-card-name" title={payload.path}>{payload.name}</span>
        <small>{t("objcard_viewed")} · {label(payload.modality)}</small>
      </div>
      <button type="button" disabled={focused} onClick={() => void reveal()}>
        {focused ? t("objcard_on_stage") : t("objcard_open_stage")}
      </button>
    </div>
  );
}
