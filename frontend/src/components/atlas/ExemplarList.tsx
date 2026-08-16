import { useEffect, useState } from "react";

import { atlasApi, AtlasApiError, type Exemplar, type ExemplarStatus, type TagCount } from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";

// 案例列表（SDD feats/03 §5.1）：搜索框（走 /exemplars/search，FTS）+ 标签筛选条（/tags）+ 状态筛选
// （active / retired / all，走 /exemplars 列表）。检索只对 active 生效（§7.7），故有 q 时状态筛选隐藏。

type StatusFilter = ExemplarStatus | "all";

export function ExemplarBadges({ ex }: { ex: Exemplar }) {
  const { t } = useI18n();
  return (
    <span className="atlas-badges">
      <span className={"atlas-badge src " + ex.source_type}>{t(`atlas_source_${ex.source_type}`)}</span>
      <span className={"atlas-badge egress " + (ex.egress === "shareable" ? "share" : "local")}>
        {t(ex.egress === "shareable" ? "atlas_egress_shareable" : "atlas_egress_local")}
      </span>
      {ex.status === "retired" && <span className="atlas-badge retired">{t("atlas_status_retired")}</span>}
      {ex.describe_status === "pending" && <span className="atlas-badge pending">{t("atlas_desc_pending")}</span>}
    </span>
  );
}

export function ExemplarList() {
  const { t } = useI18n();
  const openExemplar = useAtlasUi((s) => s.openExemplar);
  const refreshTick = useAtlasUi((s) => s.refreshTick);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [tags, setTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [rows, setRows] = useState<Exemplar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    atlasApi
      .tags("all")
      .then((tc) => alive && setTagCounts(tc))
      .catch(() => alive && setTagCounts([]));
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const query = q.trim();
    const p = query
      ? atlasApi.search({ q: query, tags, egress: "any", limit: 50 })
      : atlasApi.list({ status, tags, limit: 200 });
    p.then((r) => alive && setRows(r)).catch((e: unknown) => {
      if (!alive) return;
      setRows([]);
      setError(e instanceof AtlasApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [q, status, tags, refreshTick]);

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const filtered = q.trim() || tags.length || status !== "active";

  return (
    <div className="atlas-list">
      <div className="atlas-toolbar">
        <input
          className="dsin"
          placeholder={t("atlas_search_ph")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("atlas_search_ph")}
        />
        {!q.trim() && (
          <div className="atlas-status-filter" role="tablist">
            {(["active", "retired", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                className={"atlas-chip" + (status === s ? " on" : "")}
                onClick={() => setStatus(s)}
              >
                {t(`atlas_filter_${s}`)}
              </button>
            ))}
          </div>
        )}
        {tagCounts.length > 0 && (
          <div className="atlas-tagbar">
            {tagCounts.slice(0, 40).map((tc) => (
              <button
                key={tc.tag}
                type="button"
                className={"atlas-chip tag" + (tags.includes(tc.tag) ? " on" : "")}
                onClick={() => toggleTag(tc.tag)}
              >
                {tc.tag} <i>{tc.count}</i>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <div className="atlas-error">{t("atlas_unavailable", { why: error })}</div>}
      {rows === null && !error && <div className="atlas-empty">{t("atlas_loading")}</div>}
      {rows !== null && rows.length === 0 && !error && (
        <div className="atlas-empty">{t(filtered ? "atlas_empty_filtered" : "atlas_empty")}</div>
      )}
      {rows && rows.length > 0 && (
        <div className="atlas-grid">
          {rows.map((ex) => (
            <button
              key={ex.exemplar_id}
              type="button"
              className={"atlas-card" + (ex.status === "retired" ? " retired" : "")}
              onClick={() => openExemplar(ex.exemplar_id)}
              data-testid="exemplar-card"
            >
              <img src={atlasApi.cropUrl(ex.exemplar_id)} alt="" loading="lazy" />
              <div className="atlas-card-body">
                <div className="atlas-card-caption">{ex.caption || ex.tags_raw.join(" · ") || ex.exemplar_id.slice(0, 8)}</div>
                <div className="atlas-card-tags">
                  {ex.tags_raw.slice(0, 5).map((tg) => (
                    <span key={tg} className="atlas-tag">
                      {tg}
                    </span>
                  ))}
                </div>
                <ExemplarBadges ex={ex} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
