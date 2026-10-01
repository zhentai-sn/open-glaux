import { useEffect, useState } from "react";

import {
  atlasApi,
  AtlasApiError,
  consentRecord,
  newBatchId,
  type AtlasDescription,
  type Egress,
  type Exemplar,
  type ExemplarPatch,
  type Roi,
} from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { connectionTarget, connectionUsable, describeExemplar } from "./describe";
import { ExemplarBadges } from "./ExemplarList";
import { RoiPicker } from "./RoiPicker";

// 案例详情（SDD feats/03 §5.1、§7.8）：原图 + ROI 叠加、VLM 描述表；标签 / 图注 / 说明 / 来源 / 图册 /
// 外发许可就地编辑（PATCH，任何修改即置已确认）；重新框选、在此图上添加区域；标为已确认；
// 生成描述按钮带发送目标，点击即用户确认（D-28）。删除被引用案例返回 REFERENCED → 提示改下架（§7.7）。

function errText(e: unknown): string {
  if (e instanceof AtlasApiError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

function isDescription(d: unknown): d is AtlasDescription {
  return Boolean(d && typeof d === "object" && "summary" in (d as object));
}

function splitTags(s: string): string[] {
  return s
    .split(/[,，;；\n]/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 原图 + ROI 叠加：图按容器宽缩放，框按同一比例换算（图像像素 → 显示像素）。ROI 为 [x, y, w, h]。 */
function RoiOverlay({ ex }: { ex: Exemplar }) {
  const [nat, setNat] = useState<{ w: number; h: number; cw: number } | null>(null);
  const scale = nat ? nat.cw / nat.w : 0;
  const [x, y, w, h] = ex.roi;
  const whole = nat !== null && x === 0 && y === 0 && w === nat.w && h === nat.h;
  return (
    <div className="atlas-detail-image">
      <img
        src={atlasApi.imageUrl(ex.exemplar_id)}
        alt=""
        onLoad={(e) => {
          const el = e.currentTarget;
          setNat({ w: el.naturalWidth, h: el.naturalHeight, cw: el.clientWidth });
        }}
      />
      {nat && !whole && (
        <span className="atlas-roi-rect on static" style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale }} />
      )}
      {nat && ex.geometry && ex.geometry.length > 2 && (
        <svg className="atlas-geometry" viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none">
          <polygon points={ex.geometry.map((p) => `${p[0]},${p[1]}`).join(" ")} />
        </svg>
      )}
    </div>
  );
}

function DescriptionTable({ d }: { d: AtlasDescription }) {
  const { t } = useI18n();
  const extra = Object.entries(d.extra ?? {});
  return (
    <table className="atlas-desc">
      <tbody>
        <tr>
          <th>{t("atlas_desc_modality")}</th>
          <td>{d.modality || "—"}</td>
        </tr>
        <tr>
          <th>{t("atlas_desc_subject")}</th>
          <td>{d.subject || "—"}</td>
        </tr>
        <tr>
          <th>{t("atlas_desc_findings")}</th>
          <td>
            {d.findings?.length ? (
              <ul>
                {d.findings.map((f, i) => (
                  <li key={i}>
                    <b>{f.name}</b>
                    {f.location ? ` · ${f.location}` : ""}
                    {f.appearance ? ` · ${f.appearance}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </td>
        </tr>
        <tr>
          <th>{t("atlas_desc_pattern")}</th>
          <td>{d.pattern || "—"}</td>
        </tr>
        <tr>
          <th>{t("atlas_desc_summary")}</th>
          <td>{d.summary || "—"}</td>
        </tr>
        {extra.length > 0 && (
          <tr>
            <th>{t("atlas_desc_extra")}</th>
            <td>
              <ul>
                {extra.map(([k, v]) => (
                  <li key={k}>
                    <b>{k}</b> · {typeof v === "string" ? v : JSON.stringify(v)}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

interface Draft {
  tags: string;
  caption: string;
  notes: string;
  book: string;
  edition: string;
  collection: string;
  egress: Egress;
  consent: boolean;
}

function draftOf(ex: Exemplar): Draft {
  return {
    tags: ex.tags_raw.join(", "),
    caption: ex.caption ?? "",
    notes: ex.notes ?? "",
    book: String(ex.source.book ?? ""),
    edition: String(ex.source.edition ?? ""),
    collection: ex.collection,
    egress: ex.egress,
    consent: false,
  };
}

/** 草稿与当前案例的差异 → PATCH 字段子集；无差异返回 null。 */
function diffOf(ex: Exemplar, d: Draft): ExemplarPatch | null {
  const base = draftOf(ex);
  const p: ExemplarPatch = {};
  if (splitTags(d.tags).join("\n") !== ex.tags_raw.join("\n")) p.tags = splitTags(d.tags);
  if (d.caption.trim() !== base.caption) p.caption = d.caption.trim() || null;
  if (d.notes.trim() !== base.notes) p.notes = d.notes.trim() || null;
  if (d.book.trim() !== base.book || d.edition.trim() !== base.edition) {
    const src: Record<string, unknown> = { ...ex.source };
    for (const [k, v] of [["book", d.book.trim()], ["edition", d.edition.trim()]] as const) {
      if (v) src[k] = v;
      else delete src[k];
    }
    p.source = src;
  }
  if (d.collection.trim() !== base.collection) p.collection = d.collection.trim() || null;
  if (d.egress !== ex.egress) {
    p.egress = d.egress;
    p.egress_consent = d.egress === "shareable" ? consentRecord(newBatchId()) : null;
  }
  return Object.keys(p).length ? p : null;
}

type Busy = "" | "save" | "review" | "roi" | "retire" | "restore" | "delete" | "describe";

export function ExemplarDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const openList = useAtlasUi((s) => s.openList);
  const openExemplar = useAtlasUi((s) => s.openExemplar);
  const bump = useAtlasUi((s) => s.bumpRefresh);
  const connection = useSession((s) => s.connection);
  const [ex, setEx] = useState<Exemplar | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [roiMode, setRoiMode] = useState<null | "reframe" | "add">(null);
  const [roiDraft, setRoiDraft] = useState<Roi | null>(null);

  const load = (e: Exemplar) => {
    setEx(e);
    setDraft(draftOf(e));
  };

  useEffect(() => {
    let alive = true;
    setEx(null);
    setErr(null);
    setRoiMode(null);
    atlasApi
      .get(id)
      .then((e) => alive && load(e))
      .catch((e: unknown) => alive && setErr(errText(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const run = async (kind: Busy, fn: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(kind);
    setErr(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      if (e instanceof AtlasApiError && e.code === "REFERENCED") setErr(t("atlas_delete_referenced"));
      else if (kind === "describe") setErr(t("atlas_desc_failed", { why: errText(e) }));
      else setErr(t("atlas_action_failed", { why: errText(e) }));
    } finally {
      setBusy("");
    }
  };

  if (err && !ex) {
    return (
      <div className="atlas-detail">
        <button type="button" className="atlas-link" onClick={openList}>
          <Icon icon={ICONS.back} size="sm" /> {t("atlas_back")}
        </button>
        <div className="atlas-error">{err}</div>
      </div>
    );
  }
  if (!ex || !draft) return <div className="atlas-empty">{t("atlas_loading")}</div>;

  const patch = diffOf(ex, draft);
  const consentMissing = draft.egress === "shareable" && ex.egress !== "shareable" && !draft.consent;
  const canDescribe = connectionUsable(connection);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  const saveRoi = () => {
    if (!roiDraft) return;
    void run(
      "roi",
      async () => {
        if (roiMode === "add") {
          const r = await atlasApi.addRegion(ex.exemplar_id, roiDraft);
          bump();
          openExemplar(r.exemplar_id);
        } else {
          load(await atlasApi.patch(ex.exemplar_id, { roi: roiDraft }));
          bump();
        }
      },
      () => {
        setRoiMode(null);
        setRoiDraft(null);
      },
    );
  };

  return (
    <div className="atlas-detail" data-testid="exemplar-detail">
      <div className="atlas-detail-head">
        <button type="button" className="atlas-link" onClick={openList}>
          <Icon icon={ICONS.back} size="sm" /> {t("atlas_back")}
        </button>
        <ExemplarBadges ex={ex} />
      </div>

      {roiMode ? (
        <div className="atlas-section">
          <div className="atlas-hint">{t(roiMode === "add" ? "atlas_roi_add_hint" : "atlas_roi_reframe_hint")}</div>
          <RoiPicker
            src={atlasApi.imageUrl(ex.exemplar_id)}
            rois={roiDraft ? [roiDraft] : []}
            activeIndex={0}
            onChange={(rois) => setRoiDraft(rois.length ? rois[rois.length - 1]! : null)}
          />
          <div className="atlas-actions">
            <button type="button" className="dsbtn" disabled={!roiDraft || !!busy} onClick={saveRoi} data-testid="roi-save">
              {t(roiMode === "add" ? "atlas_roi_add_save" : "atlas_roi_save")}
            </button>
            {roiMode === "reframe" && (
              <button
                type="button"
                className="atlas-btn"
                disabled={!!busy}
                onClick={() => {
                  const img = new Image();
                  img.onload = () => setRoiDraft([0, 0, img.naturalWidth, img.naturalHeight]);
                  img.src = atlasApi.imageUrl(ex.exemplar_id);
                }}
              >
                {t("atlas_roi_whole")}
              </button>
            )}
            <button type="button" className="atlas-btn" onClick={() => (setRoiMode(null), setRoiDraft(null))}>
              {t("atlas_cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <RoiOverlay ex={ex} />
          <div className="atlas-actions">
            <button type="button" className="atlas-btn" onClick={() => setRoiMode("reframe")}>
              {t("atlas_roi_reframe")}
            </button>
            <button type="button" className="atlas-btn" onClick={() => setRoiMode("add")}>
              {t("atlas_roi_add")}
            </button>
          </div>
        </>
      )}

      <div className="atlas-form" data-testid="exemplar-form">
        <label>
          <span>{t("atlas_caption")}</span>
          <input className="dsin" value={draft.caption} onChange={set("caption")} />
        </label>
        <label>
          <span>{t("atlas_tags")}</span>
          <input className="dsin" placeholder={t("atlas_tags_ph")} value={draft.tags} onChange={set("tags")} />
        </label>
        <label>
          <span>{t("atlas_notes")}</span>
          <textarea className="dsin" rows={2} value={draft.notes} onChange={set("notes")} />
        </label>
        <label>
          <span>{t("atlas_collection")}</span>
          <input className="dsin" placeholder={t("atlas_coll_ph")} value={draft.collection} onChange={set("collection")} />
        </label>
        <label>
          <span>{t("atlas_source_book")}</span>
          <input className="dsin" value={draft.book} onChange={set("book")} />
        </label>
        <label>
          <span>{t("atlas_source_edition")}</span>
          <input className="dsin" value={draft.edition} onChange={set("edition")} />
        </label>
        <label>
          <span>{t("atlas_egress")}</span>
          <select className="dsin" value={draft.egress} onChange={(e) => setDraft({ ...draft, egress: e.target.value as Egress, consent: false })}>
            <option value="local-only">{t("atlas_egress_local")}</option>
            <option value="shareable">{t("atlas_egress_shareable")}</option>
          </select>
        </label>
        {draft.egress === "shareable" && ex.egress !== "shareable" && (
          <label className="atlas-consent">
            <input type="checkbox" checked={draft.consent} onChange={(e) => setDraft({ ...draft, consent: e.target.checked })} data-testid="consent" />
            <span>{t("atlas_consent_text")}</span>
          </label>
        )}
        <div className="atlas-actions">
          <button
            type="button"
            className="dsbtn"
            disabled={!patch || consentMissing || !!busy}
            onClick={() =>
              void run("save", async () => {
                load(await atlasApi.patch(ex.exemplar_id, patch!));
                bump();
              })
            }
            data-testid="exemplar-save"
          >
            {busy === "save" ? "…" : t("atlas_save")}
          </button>
          {patch && (
            <button type="button" className="atlas-btn" onClick={() => setDraft(draftOf(ex))}>
              {t("atlas_cancel")}
            </button>
          )}
          {!ex.reviewed && !patch && (
            <button
              type="button"
              className="atlas-btn"
              disabled={!!busy}
              onClick={() =>
                void run("review", async () => {
                  load(await atlasApi.patch(ex.exemplar_id, { reviewed: true }));
                  bump();
                })
              }
            >
              {t("atlas_mark_reviewed")}
            </button>
          )}
        </div>
      </div>

      <dl className="atlas-kv">
        <dt>{t("atlas_roi")}</dt>
        <dd className="mono">[{ex.roi.join(", ")}]</dd>
        <dt>{t("atlas_source")}</dt>
        <dd>
          {Object.entries(ex.source)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(" · ") || ex.source_type}
        </dd>
        <dt>{t("atlas_created")}</dt>
        <dd className="mono">{ex.created_at}</dd>
      </dl>

      <div className="atlas-section">
        {isDescription(ex.description) ? (
          <DescriptionTable d={ex.description} />
        ) : (
          <div className="atlas-desc-missing">
            {t(ex.describe_status === "skipped" ? "atlas_desc_skipped" : "atlas_desc_pending")}
          </div>
        )}
        <div className="atlas-actions">
          <button
            type="button"
            className="dsbtn"
            disabled={!!busy || !canDescribe}
            onClick={() =>
              void run("describe", async () => {
                load(await describeExemplar(ex, connection));
                bump();
              })
            }
            data-testid="describe-one"
          >
            {busy === "describe" ? t("atlas_desc_generating") : t("atlas_describe_to", { target: connectionTarget(connection) })}
          </button>
          {!canDescribe && <span className="atlas-hint">{t("atlas_desc_need_model")}</span>}
        </div>
      </div>

      <div className="atlas-actions">
        {ex.status === "active" ? (
          <button
            type="button"
            className="atlas-btn"
            disabled={!!busy}
            onClick={() =>
              void run("retire", () => atlasApi.retire(ex.exemplar_id), () => {
                setEx({ ...ex, status: "retired" });
                bump();
              })
            }
          >
            {t("atlas_retire")}
          </button>
        ) : (
          <button
            type="button"
            className="atlas-btn"
            disabled={!!busy}
            onClick={() =>
              void run("restore", () => atlasApi.restore(ex.exemplar_id), () => {
                setEx({ ...ex, status: "active" });
                bump();
              })
            }
          >
            {t("atlas_restore")}
          </button>
        )}
        <button
          type="button"
          className="atlas-btn danger"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm(t("atlas_delete_confirm"))) return;
            void run("delete", () => atlasApi.remove(ex.exemplar_id), () => {
              bump();
              openList();
            });
          }}
        >
          {t("atlas_delete")}
        </button>
      </div>
      {err && <div className="atlas-error">{err}</div>}
    </div>
  );
}
