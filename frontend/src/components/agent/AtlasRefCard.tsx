import { useEffect, useState } from "react";

import { atlasApi, type Exemplar } from "../../api/atlas";
import type { AtlasReferencedPayload } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { revealExemplar } from "../../store/atlas";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 会话中的"参考图谱 N 条"卡片（SDD feats/03 §5.1 / §12 / §13）：渲染 `atlas.referenced` payload——
// 候选 N、选中 K、被外发限制排除 M；每条选中案例显示缩略图，点开跳到图谱详情；
// 案例已下架/删除时以事件快照（caption/tags）降级展示并标记。会话中出现该卡片依赖 SDD 02 的 locate_roi
// 把 payload 放进工具结果（details.kind = ATLAS_REFERENCED_KIND）；本组件只负责解析与渲染。

export const ATLAS_REFERENCED_KIND = "glaux.atlas_referenced";

/** 从工具结果 details（或任意对象）里解析 payload；形状不符返回 null。 */
export function parseAtlasReferenced(value: unknown): AtlasReferencedPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const p = (v.kind === ATLAS_REFERENCED_KIND && v.payload && typeof v.payload === "object" ? v.payload : v) as Record<string, unknown>;
  if (typeof p.trace_id !== "string") return null;
  if (!Array.isArray(p.candidate_ids) || !Array.isArray(p.selected_ids)) return null;
  const snapshots = Array.isArray(p.snapshots) ? p.snapshots : [];
  return {
    trace_id: p.trace_id,
    candidate_ids: p.candidate_ids.filter((x): x is string => typeof x === "string"),
    selected_ids: p.selected_ids.filter((x): x is string => typeof x === "string"),
    excluded_by_egress: typeof p.excluded_by_egress === "number" ? p.excluded_by_egress : 0,
    snapshots: snapshots
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
      .map((s) => ({
        exemplar_id: String(s.exemplar_id ?? ""),
        caption: typeof s.caption === "string" ? s.caption : "",
        tags: Array.isArray(s.tags) ? s.tags.filter((x): x is string => typeof x === "string") : [],
      })),
  };
}

type Live = { state: "loading" } | { state: "ok"; ex: Exemplar } | { state: "missing" };

function RefItem({ id, snapshot }: { id: string; snapshot?: AtlasReferencedPayload["snapshots"][number] }) {
  const { t } = useI18n();
  const [live, setLive] = useState<Live>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    atlasApi
      .get(id)
      .then((ex) => alive && setLive({ state: "ok", ex }))
      .catch(() => alive && setLive({ state: "missing" }));
    return () => {
      alive = false;
    };
  }, [id]);

  const retired = live.state === "ok" && live.ex.status === "retired";
  const missing = live.state === "missing";
  const caption = live.state === "ok" ? live.ex.caption || live.ex.tags_raw.join(" · ") : snapshot?.caption || snapshot?.tags.join(" · ") || id.slice(0, 8);
  return (
    <button
      type="button"
      className={"atlas-ref-item" + (missing || retired ? " degraded" : "")}
      onClick={() => revealExemplar(id)}
      title={t("atlas_ref_open")}
      data-testid="atlas-ref-item"
    >
      {!missing ? <img src={atlasApi.cropUrl(id)} alt="" /> : <span className="atlas-ref-thumb-missing">?</span>}
      <span className="atlas-ref-caption">{caption}</span>
      {(missing || retired) && <span className="atlas-badge retired">{missing ? t("atlas_ref_missing") : t("atlas_status_retired")}</span>}
    </button>
  );
}

export function AtlasRefCard({ payload }: { payload: AtlasReferencedPayload }) {
  const { t } = useI18n();
  const n = payload.selected_ids.length;
  const snap = new Map(payload.snapshots.map((s) => [s.exemplar_id, s]));
  return (
    <div className="atlas-ref-card" data-testid="atlas-ref-card">
      <div className="atlas-ref-head">
        <Icon icon={ICONS.atlas} size="sm" />
        <b>{n > 0 ? t("atlas_ref_title", { n }) : t("atlas_ref_none")}</b>
        {payload.candidate_ids.length > 0 && <span className="atlas-ref-meta">{t("atlas_ref_candidates", { n: payload.candidate_ids.length })}</span>}
      </div>
      {n > 0 && (
        <div className="atlas-ref-items">
          {payload.selected_ids.map((id) => (
            <RefItem key={id} id={id} snapshot={snap.get(id)} />
          ))}
        </div>
      )}
      {payload.excluded_by_egress > 0 && <div className="atlas-ref-excluded">{t("atlas_ref_excluded", { n: payload.excluded_by_egress })}</div>}
    </div>
  );
}
