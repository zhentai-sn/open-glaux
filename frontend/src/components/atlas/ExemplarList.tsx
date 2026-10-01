import { useEffect, useState } from "react";

import {
  atlasApi,
  AtlasApiError,
  consentRecord,
  newBatchId,
  type CollectionCount,
  type Egress,
  type Exemplar,
  type ExemplarStatus,
  type TagCount,
} from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { CollectionTree, type CollectionFilter } from "./CollectionTree";
import { connectionTarget, connectionUsable, runDescribeQueue } from "./describe";

// 案例列表（SDD feats/03 §5.1）：搜索框（走 /exemplars/search，FTS）+ 标签筛选条（/tags）+ 状态筛选
// （active / retired / all，走 /exemplars 列表）+「待描述」「未确认」筛选。检索只对 active 生效（§7.7），
// 故有 q 时状态筛选隐藏。多选后批量操作逐条调用单条端点，按条汇报（§7.8 第 8 条）。

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
      {!ex.reviewed && <span className="atlas-badge unreviewed">{t("atlas_unreviewed")}</span>}
    </span>
  );
}

function errText(e: unknown): string {
  if (e instanceof AtlasApiError) return e.code;
  return e instanceof Error ? e.message : String(e);
}

/** 批量操作栏：逐条执行，单条失败不影响其它条（§7.8 第 8 条）。 */
function BatchBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const { t } = useI18n();
  const bump = useAtlasUi((s) => s.bumpRefresh);
  const connection = useSession((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [coll, setColl] = useState("");
  const [egress, setEgress] = useState<Egress>("local-only");
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const run = async (fn: (id: string) => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setReport(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await fn(id);
      } catch (e) {
        failed.push(`${id.slice(0, 8)}（${errText(e)}）`);
      }
    }
    setBusy(false);
    setReport(
      t("atlas_batch_done", { ok: ids.length - failed.length, failed: failed.length }) +
        (failed.length ? `：${failed.join("、")}` : ""),
    );
    bump();
    if (!failed.length) onClear();
  };

  const describe = () => {
    if (!window.confirm(t("atlas_describe_confirm", { n: ids.length, target: connectionTarget(connection) }))) return;
    void runDescribeQueue(ids, connection);
    onClear();
  };

  const applyEgress = () => {
    const batch = newBatchId();
    const consentRec = egress === "shareable" ? consentRecord(batch) : null;
    void run((id) => atlasApi.patch(id, { egress, egress_consent: consentRec }));
  };

  return (
    <div className="atlas-batch" data-testid="atlas-batch">
      <div className="atlas-actions">
        <b>{t("atlas_batch_selected", { n: ids.length })}</b>
        <button type="button" className="atlas-link" onClick={onClear}>
          {t("atlas_batch_clear")}
        </button>
      </div>
      <div className="atlas-actions">
        <input
          className="dsin"
          placeholder={t("atlas_coll_ph")}
          aria-label={t("atlas_collection")}
          value={coll}
          onChange={(e) => setColl(e.target.value)}
        />
        <button type="button" className="atlas-btn" disabled={busy} onClick={() => void run((id) => atlasApi.patch(id, { collection: coll.trim() || null }))}>
          {t("atlas_coll_move")}
        </button>
      </div>
      <div className="atlas-actions">
        <select className="dsin" aria-label={t("atlas_egress")} value={egress} onChange={(e) => setEgress(e.target.value as Egress)}>
          <option value="local-only">{t("atlas_egress_local")}</option>
          <option value="shareable">{t("atlas_egress_shareable")}</option>
        </select>
        <button type="button" className="atlas-btn" disabled={busy || (egress === "shareable" && !consent)} onClick={applyEgress}>
          {t("atlas_apply")}
        </button>
      </div>
      {egress === "shareable" && (
        <label className="atlas-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="batch-consent" />
          <span>{t("atlas_consent_text")}</span>
        </label>
      )}
      <div className="atlas-actions">
        <button type="button" className="atlas-btn" disabled={busy} onClick={() => void run((id) => atlasApi.patch(id, { reviewed: true }))}>
          {t("atlas_mark_reviewed")}
        </button>
        <button type="button" className="atlas-btn" disabled={busy || !connectionUsable(connection)} onClick={describe}>
          {t("atlas_describe_go")}
        </button>
        <button type="button" className="atlas-btn" disabled={busy} onClick={() => void run((id) => atlasApi.retire(id))}>
          {t("atlas_retire")}
        </button>
        <button
          type="button"
          className="atlas-btn danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("atlas_batch_delete_confirm", { n: ids.length }))) void run((id) => atlasApi.remove(id));
          }}
        >
          {t("atlas_delete")}
        </button>
      </div>
      {report && <div className="atlas-hint">{report}</div>}
    </div>
  );
}

export function ExemplarList() {
  const { t } = useI18n();
  const openExemplar = useAtlasUi((s) => s.openExemplar);
  const refreshTick = useAtlasUi((s) => s.refreshTick);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [collCounts, setCollCounts] = useState<CollectionCount[]>([]);
  const collFilter = useAtlasUi((s) => s.collectionFilter);
  const setCollFilter = useAtlasUi((s) => s.setCollectionFilter);
  const [rows, setRows] = useState<Exemplar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    atlasApi
      .tags("all")
      .then((tc) => alive && setTagCounts(tc))
      .catch(() => alive && setTagCounts([]));
    atlasApi
      .collections(status)
      .then((cc) => alive && setCollCounts(cc))
      .catch(() => alive && setCollCounts([]));
    return () => {
      alive = false;
    };
  }, [refreshTick, status]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const query = q.trim();
    // 图册是范围（前缀），标签/文本是维度（SDD 03 §7.2 v1.1）；"未分册"只对列表有意义（search 无 exact）
    const listColl = collFilter === null ? {} : collFilter.exact ? { collection: "", collection_exact: true } : { collection: collFilter.path };
    const searchColl = collFilter && !collFilter.exact ? { collection: collFilter.path } : {};
    const p = query
      ? atlasApi.search({ q: query, tags, egress: "any", limit: 50, ...searchColl })
      : atlasApi.list({
          status,
          tags,
          limit: 200,
          ...listColl,
          ...(pendingOnly ? { describe_status: "pending" as const } : {}),
          ...(unreviewedOnly ? { reviewed: false } : {}),
        });
    p.then((r) => alive && setRows(r)).catch((e: unknown) => {
      if (!alive) return;
      setRows([]);
      setError(e instanceof AtlasApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [q, status, tags, refreshTick, collFilter, pendingOnly, unreviewedOnly]);

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filtered = q.trim() || tags.length || status !== "active" || collFilter !== null || pendingOnly || unreviewedOnly;
  const onCollChange = (f: CollectionFilter) => setCollFilter(f);
  const visibleIds = rows?.map((r) => r.exemplar_id) ?? [];
  const selIds = visibleIds.filter((id) => selected.has(id));

  return (
    <div className="atlas-list">
      {collCounts.length > 0 && <CollectionTree counts={collCounts} filter={collFilter} onChange={onCollChange} />}
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
            <button type="button" aria-pressed={pendingOnly} className={"atlas-chip" + (pendingOnly ? " on" : "")} onClick={() => setPendingOnly((v) => !v)}>
              {t("atlas_desc_pending")}
            </button>
            <button
              type="button"
              aria-pressed={unreviewedOnly}
              className={"atlas-chip" + (unreviewedOnly ? " on" : "")}
              onClick={() => setUnreviewedOnly((v) => !v)}
            >
              {t("atlas_unreviewed")}
            </button>
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
        {rows && rows.length > 0 && (
          <div className="atlas-actions">
            <button type="button" className="atlas-link" onClick={() => setSelected(new Set(selIds.length === visibleIds.length ? [] : visibleIds))}>
              {t(selIds.length === visibleIds.length ? "atlas_batch_clear" : "atlas_batch_all")}
            </button>
          </div>
        )}
      </div>
      {selIds.length > 0 && <BatchBar ids={selIds} onClear={() => setSelected(new Set())} />}
      {error && <div className="atlas-error">{t("atlas_unavailable", { why: error })}</div>}
      {rows === null && !error && (
        <div className="atlas-grid atlas-skeleton" role="status" aria-label={t("atlas_loading")} data-testid="atlas-skeleton">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="sk-card">
              <div className="sk-thumb" />
              <div className="sk-lines">
                <div className="sk-line" />
                <div className="sk-line short" />
              </div>
            </div>
          ))}
        </div>
      )}
      {rows !== null && rows.length === 0 && !error && (
        <div className="atlas-empty">{t(filtered ? "atlas_empty_filtered" : "atlas_empty")}</div>
      )}
      {rows && rows.length > 0 && (
        <div className="atlas-grid">
          {rows.map((ex) => {
            const on = selected.has(ex.exemplar_id);
            return (
              <div
                key={ex.exemplar_id}
                className={"atlas-card pick" + (on ? " on" : "") + (ex.status === "retired" ? " retired" : "")}
                data-testid="exemplar-card"
              >
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={t("atlas_select")}
                  onChange={() => toggleSel(ex.exemplar_id)}
                />
                <button type="button" className="atlas-card-open" onClick={() => openExemplar(ex.exemplar_id)}>
                  <img src={atlasApi.cropUrl(ex.exemplar_id)} alt="" loading="lazy" />
                  <div className="atlas-card-body">
                    <div className="atlas-card-caption">
                      {ex.caption || ex.tags_raw.join(" · ") || String(ex.source.filename ?? ex.exemplar_id.slice(0, 8))}
                    </div>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
