import { useEffect, useState } from "react";

import { atlasApi, AtlasApiError, type AtlasDescription, type Exemplar } from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { connectionUsable, describeExemplar } from "./describe";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { ExemplarBadges } from "./ExemplarList";

// 案例详情（SDD feats/03 §5.1）：原图 + ROI 叠加 + 图注 + VLM 描述表 + 来源 + 外发徽标 +
// 下架 / 恢复 / 删除 / 重试描述。删除被引用案例后端返回 EXEMPLAR_REFERENCED → 提示改下架（§7.7）。

function errText(e: unknown): string {
  if (e instanceof AtlasApiError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

function isDescription(d: unknown): d is AtlasDescription {
  return Boolean(d && typeof d === "object" && "summary" in (d as object));
}

/** 原图 + ROI 叠加：图按容器宽缩放，框按同一比例换算（图像像素 → 显示像素）。 */
function RoiOverlay({ ex }: { ex: Exemplar }) {
  const [nat, setNat] = useState<{ w: number; h: number; cw: number } | null>(null);
  const scale = nat ? nat.cw / nat.w : 0;
  const [x0, y0, x1, y1] = ex.roi;
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
      {nat && (
        <span
          className="atlas-roi-rect on static"
          style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }}
        />
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

export function ExemplarDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const openList = useAtlasUi((s) => s.openList);
  const bump = useAtlasUi((s) => s.bumpRefresh);
  const connection = useSession((s) => s.connection);
  const [ex, setEx] = useState<Exemplar | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "retire" | "restore" | "delete" | "describe" | "move">("");
  const [collDraft, setCollDraft] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEx(null);
    setErr(null);
    atlasApi
      .get(id)
      .then((e) => alive && setEx(e))
      .catch((e: unknown) => alive && setErr(errText(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const run = async (kind: typeof busy, fn: () => Promise<unknown>, after?: () => void) => {
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
  if (!ex) return <div className="atlas-empty">{t("atlas_loading")}</div>;

  const src = ex.source ?? {};
  const srcLine = Object.entries(src)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
  const canDescribe = connectionUsable(connection);

  return (
    <div className="atlas-detail" data-testid="exemplar-detail">
      <div className="atlas-detail-head">
        <button type="button" className="atlas-link" onClick={openList}>
          <Icon icon={ICONS.back} size="sm" /> {t("atlas_back")}
        </button>
        <ExemplarBadges ex={ex} />
      </div>
      <RoiOverlay ex={ex} />
      <dl className="atlas-kv">
        <dt>{t("atlas_caption")}</dt>
        <dd>{ex.caption || "—"}</dd>
        <dt>{t("atlas_tags")}</dt>
        <dd>
          {ex.tags_raw.map((tg) => (
            <span key={tg} className="atlas-tag">
              {tg}
            </span>
          ))}
        </dd>
        {ex.notes && (
          <>
            <dt>{t("atlas_notes")}</dt>
            <dd>{ex.notes}</dd>
          </>
        )}
        <dt>{t("atlas_collection")}</dt>
        <dd className="atlas-coll-edit">
          <input
            className="dsin"
            aria-label={t("atlas_collection")}
            placeholder={t("atlas_coll_ph")}
            value={collDraft ?? ex.collection}
            onChange={(e) => setCollDraft(e.target.value)}
          />
          <button
            type="button"
            className="atlas-btn"
            disabled={!!busy || collDraft === null || collDraft.trim() === ex.collection}
            onClick={() =>
              void run("move", async () => {
                const next = await atlasApi.setCollection(ex.exemplar_id, collDraft ?? "");
                setEx(next);
                setCollDraft(null);
                bump();
              })
            }
          >
            {busy === "move" ? "…" : t("atlas_coll_move")}
          </button>
        </dd>
        <dt>{t("atlas_roi")}</dt>
        <dd className="mono">[{ex.roi.join(", ")}]</dd>
        <dt>{t("atlas_source")}</dt>
        <dd>{srcLine || ex.source_type}</dd>
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
            title={canDescribe ? undefined : t("atlas_desc_need_model")}
            onClick={() => void run("describe", async () => setEx(await describeExemplar(ex, connection)))}
          >
            {busy === "describe" ? t("atlas_desc_generating") : t("atlas_desc_retry")}
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
