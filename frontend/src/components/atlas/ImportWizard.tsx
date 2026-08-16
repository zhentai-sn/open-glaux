import { useEffect, useMemo, useRef, useState } from "react";

import {
  atlasApi,
  AtlasApiError,
  type CreateResult,
  type Exemplar,
  type ExemplarInput,
  type ImportSession,
  type SourceType,
} from "../../api/atlas";
import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { connectionUsable, describeExemplar } from "./describe";
import { RoiPicker, type Roi } from "./RoiPicker";

// 导入向导（SDD feats/03 §6.1 / §4.1 / D-16）三步：
// ① 来源：PDF 上传或网页 URL → backend 抽候选（暂存不入库）；NO_FIGURES_FOUND / FETCH_* → 引导手动上传
// ② 框选与标签：逐张候选 RoiPicker，一图多框，每框独立标签 + 图注（默认带入抽取图注）
// ③ 来源信息 + 外发许可（缺省 local-only；shareable 须勾选协议，勾选记录随请求 egress_consent 保存）
// 提交后可选逐条调 runtime 生成描述（凭据只到 runtime，结果写回 backend）。

export const CONSENT_STATEMENT_VERSION = "v1";

type Mode = "pdf" | "url";
type Step = 1 | 2 | 3 | 4;

interface Region {
  roi: Roi;
  tags: string;
  caption: string;
}

/** 一张待标注的图：候选（import_id + figure_index）或手动上传（base64）。 */
interface Figure {
  key: string;
  src: string;
  caption: string;
  nearby: string[];
  ref: { import_id: string; figure_index: number } | { image_base64: string };
}

function splitTags(s: string): string[] {
  return s
    .split(/[,，;；\n]/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

function errCode(e: unknown): string {
  return e instanceof AtlasApiError ? e.code : e instanceof Error ? e.message : String(e);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function newBatchId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ImportWizard({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const openList = useAtlasUi((s) => s.openList);
  const bump = useAtlasUi((s) => s.bumpRefresh);
  const connection = useSession((s) => s.connection);

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("pdf");
  const [pdf, setPdf] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; msg: string } | null>(null);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [manual, setManual] = useState<Figure[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [regions, setRegions] = useState<Record<string, Region[]>>({});
  const [activeRegion, setActiveRegion] = useState<Record<string, number>>({});
  const [srcName, setSrcName] = useState("");
  const [srcEdition, setSrcEdition] = useState("");
  const [srcPage, setSrcPage] = useState("");
  const [collection, setCollection] = useState(() => {
    // 缺省带入当前图册筛选（在某图册里点"导入"，新案例自然归到该图册）
    const f = useAtlasUi.getState().collectionFilter;
    return f && !f.exact ? f.path : "";
  });
  const [egress, setEgress] = useState<"shareable" | "local-only">("local-only");
  const [consent, setConsent] = useState(false);
  const [describe, setDescribe] = useState(true);
  const [result, setResult] = useState<{ created: number; existing: number; ids: string[] } | null>(null);
  const [descProgress, setDescProgress] = useState<{ done: number; total: number; ok: number; failed: number } | null>(null);

  // 离开向导（未提交）时丢弃暂存会话——不留残留（SDD §11 importing → [*]）。用 ref 只在卸载时判断。
  const liveRef = useRef<{ session: ImportSession | null; submitted: boolean }>({ session: null, submitted: false });
  liveRef.current = { session, submitted: result !== null };
  useEffect(() => {
    return () => {
      const { session: s, submitted } = liveRef.current;
      if (s && !submitted) void atlasApi.discardImport(s.import_id).catch(() => undefined);
    };
  }, []);

  const figures: Figure[] = useMemo(() => {
    const fromSession: Figure[] = session
      ? session.figures.map((f) => ({
          key: `fig:${f.index}`,
          src: atlasApi.importFigureUrl(session.import_id, f.index),
          caption: f.caption,
          nearby: f.nearby,
          ref: { import_id: session.import_id, figure_index: f.index },
        }))
      : [];
    return [...fromSession, ...manual];
  }, [session, manual]);

  const sourceType: SourceType = session?.source_type ?? (mode === "url" ? "web" : "textbook");
  const selectedFigures = figures.filter((f) => picked.has(f.key));
  const totalRegions = selectedFigures.reduce((n, f) => n + (regions[f.key]?.length ?? 0), 0);
  const canDescribe = connectionUsable(connection);

  const extract = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = mode === "pdf" && pdf ? await atlasApi.importPdf(pdf) : await atlasApi.importUrl(url.trim());
      setSession(s);
      setPicked(new Set(s.figures.map((f) => `fig:${f.index}`)));
    } catch (e) {
      setError({ code: errCode(e), msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const addManual = async (files: FileList | null) => {
    if (!files) return;
    const next: Figure[] = [];
    for (const f of Array.from(files)) {
      const dataUrl = await fileToDataUrl(f);
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      next.push({ key: `manual:${f.name}:${f.size}`, src: dataUrl, caption: "", nearby: [], ref: { image_base64: b64 } });
    }
    setManual((m) => [...m, ...next.filter((n) => !m.some((x) => x.key === n.key))]);
    setPicked((p) => new Set([...p, ...next.map((n) => n.key)]));
    setError(null);
  };

  const togglePick = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const setFigRois = (fig: Figure, rois: Roi[]) =>
    setRegions((r) => {
      const prev = r[fig.key] ?? [];
      const next = rois.map((roi, i) => prev[i] ?? { roi, tags: "", caption: fig.caption });
      next.forEach((rg, i) => (rg.roi = rois[i]!));
      return { ...r, [fig.key]: next };
    });

  const patchRegion = (key: string, i: number, patch: Partial<Region>) =>
    setRegions((r) => ({ ...r, [key]: (r[key] ?? []).map((rg, j) => (j === i ? { ...rg, ...patch } : rg)) }));

  const wholeImage = (fig: Figure) => {
    const img = new Image();
    img.onload = () => setFigRois(fig, [...(regions[fig.key] ?? []).map((r) => r.roi), [0, 0, img.naturalWidth, img.naturalHeight]]);
    img.src = fig.src;
  };

  const step2Valid = totalRegions > 0 && selectedFigures.every((f) => (regions[f.key] ?? []).every((rg) => splitTags(rg.tags).length > 0));
  const step3Valid = srcName.trim().length > 0 && (egress === "local-only" || consent);

  const submit = async () => {
    if (!step3Valid || busy) return;
    setBusy(true);
    setError(null);
    const batchId = newBatchId();
    const source: Record<string, unknown> = {
      ...(session?.origin ?? {}),
      name: srcName.trim(),
      ...(srcEdition.trim() ? { edition: srcEdition.trim() } : {}),
      ...(srcPage.trim() ? { page: srcPage.trim() } : {}),
    };
    const egressConsent =
      egress === "shareable"
        ? { confirmed_at: new Date().toISOString(), import_batch_id: batchId, statement_version: CONSENT_STATEMENT_VERSION }
        : null;
    const items: ExemplarInput[] = [];
    for (const f of selectedFigures) {
      for (const rg of regions[f.key] ?? []) {
        items.push({
          roi: rg.roi,
          tags: splitTags(rg.tags),
          source_type: sourceType,
          source,
          egress,
          egress_consent: egressConsent,
          caption: rg.caption.trim() || null,
          collection: collection.trim() || null,
          ...f.ref,
        });
      }
    }
    try {
      const out: CreateResult[] = await atlasApi.create(items, batchId);
      const created = out.filter((o) => o.created).length;
      const ids = out.map((o) => o.exemplar_id);
      setResult({ created, existing: out.length - created, ids });
      setStep(4);
      bump();
      if (describe && canDescribe && ids.length) {
        setDescProgress({ done: 0, total: ids.length, ok: 0, failed: 0 });
        let ok = 0;
        let failed = 0;
        for (let i = 0; i < ids.length; i++) {
          try {
            const ex: Exemplar = await atlasApi.get(ids[i]!);
            if (ex.describe_status !== "done") await describeExemplar(ex, connection);
            ok++;
          } catch {
            failed++;
          }
          setDescProgress({ done: i + 1, total: ids.length, ok, failed });
        }
        bump();
      }
    } catch (e) {
      setError({ code: errCode(e), msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const noFigures = error?.code === "NO_FIGURES_FOUND";
  const blocked = error?.code === "FETCH_BLOCKED";

  return (
    <div className="atlas-wizard" data-testid="import-wizard">
      <div className="atlas-detail-head">
        <b>{t("atlas_wiz_title")}</b>
        <span className="atlas-steps">
          {([1, 2, 3] as const).map((s) => (
            <span key={s} className={"atlas-step" + (step === s ? " on" : step > s ? " done" : "")}>
              {s}. {t(`atlas_wiz_step${s}`)}
            </span>
          ))}
        </span>
      </div>

      {step === 1 && (
        <div className="atlas-wiz-body">
          <div className="atlas-status-filter" role="tablist">
            {(["pdf", "url"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={"atlas-chip" + (mode === m ? " on" : "")} onClick={() => setMode(m)}>
                {t(m === "pdf" ? "atlas_wiz_pdf" : "atlas_wiz_url")}
              </button>
            ))}
          </div>
          {mode === "pdf" ? (
            <input key="pdf" className="dsin" type="file" accept="application/pdf" aria-label={t("atlas_wiz_pdf")} onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          ) : (
            <input key="url" className="dsin" placeholder={t("atlas_wiz_url_ph")} aria-label={t("atlas_wiz_url")} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void extract()} />
          )}
          <div className="atlas-actions">
            <button type="button" className="dsbtn" disabled={busy || (mode === "pdf" ? !pdf : !url.trim())} onClick={() => void extract()}>
              {busy ? t("atlas_wiz_extracting") : t("atlas_wiz_fetch")}
            </button>
            <label className="atlas-btn atlas-file">
              {t("atlas_wiz_upload_manual")}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => void addManual(e.target.files)} data-testid="manual-upload" />
            </label>
          </div>
          {error && (
            <div className={"atlas-error" + (noFigures ? " guide" : "")} role="alert">
              {noFigures ? t("atlas_wiz_no_figures") : blocked ? t("atlas_wiz_fetch_blocked") : error.code === "FETCH_FAILED" ? t("atlas_wiz_fetch_failed", { why: error.msg }) : `${error.code}: ${error.msg}`}
            </div>
          )}
          {figures.length > 0 && (
            <>
              <div className="atlas-hint">{t("atlas_wiz_candidates", { n: figures.length })}</div>
              <div className="atlas-grid">
                {figures.map((f) => (
                  <label key={f.key} className={"atlas-card pick" + (picked.has(f.key) ? " on" : "")}>
                    <input type="checkbox" checked={picked.has(f.key)} onChange={() => togglePick(f.key)} />
                    <img src={f.src} alt="" />
                    <div className="atlas-card-body">
                      <div className="atlas-card-caption">{f.caption || "—"}</div>
                      {f.nearby.length > 0 && <div className="atlas-card-nearby">{f.nearby[0]}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="atlas-wiz-body">
          <div className="atlas-hint">{t("atlas_wiz_roi_hint")}</div>
          {selectedFigures.map((f) => {
            const rs = regions[f.key] ?? [];
            return (
              <div key={f.key} className="atlas-fig-editor">
                <RoiPicker src={f.src} rois={rs.map((r) => r.roi)} activeIndex={activeRegion[f.key]} onPick={(i) => setActiveRegion((a) => ({ ...a, [f.key]: i }))} onChange={(rois) => setFigRois(f, rois)} />
                <div className="atlas-fig-side">
                  <div className="atlas-actions">
                    <span className="atlas-hint">{t("atlas_wiz_regions", { n: rs.length })}</span>
                    <button type="button" className="atlas-btn" onClick={() => wholeImage(f)}>
                      {t("atlas_wiz_add_full")}
                    </button>
                  </div>
                  {rs.map((rg, i) => (
                    <div key={i} className={"atlas-region" + (activeRegion[f.key] === i ? " on" : "")} onFocus={() => setActiveRegion((a) => ({ ...a, [f.key]: i }))}>
                      <span className="atlas-region-no">{i + 1}</span>
                      <input className="dsin" placeholder={t("atlas_wiz_tags_ph")} aria-label={`tags ${i + 1}`} value={rg.tags} onChange={(e) => patchRegion(f.key, i, { tags: e.target.value })} list="atlas-tag-suggest" />
                      <input className="dsin" placeholder={t("atlas_wiz_caption_ph")} aria-label={`caption ${i + 1}`} value={rg.caption} onChange={(e) => patchRegion(f.key, i, { caption: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <TagSuggest />
          {!step2Valid && <div className="atlas-hint warn">{t("atlas_wiz_no_regions")}</div>}
        </div>
      )}

      {step === 3 && (
        <div className="atlas-wiz-body">
          <input className="dsin" placeholder={t("atlas_wiz_source_name")} aria-label={t("atlas_wiz_source_name")} value={srcName} onChange={(e) => setSrcName(e.target.value)} />
          <input className="dsin" placeholder={t("atlas_coll_ph")} aria-label={t("atlas_collection")} value={collection} onChange={(e) => setCollection(e.target.value)} list="atlas-coll-suggest" />
          <CollectionSuggest />
          <div className="atlas-row">
            <input className="dsin" placeholder={t("atlas_wiz_source_edition")} aria-label={t("atlas_wiz_source_edition")} value={srcEdition} onChange={(e) => setSrcEdition(e.target.value)} />
            <input className="dsin" placeholder={t("atlas_wiz_source_page")} aria-label={t("atlas_wiz_source_page")} value={srcPage} onChange={(e) => setSrcPage(e.target.value)} />
          </div>
          <div className="atlas-section">
            <div className="atlas-hint">{t("atlas_wiz_egress")}</div>
            <div className="atlas-status-filter" role="radiogroup">
              <button type="button" role="radio" aria-checked={egress === "local-only"} className={"atlas-chip" + (egress === "local-only" ? " on" : "")} onClick={() => setEgress("local-only")}>
                {t("atlas_egress_local")}
              </button>
              <button type="button" role="radio" aria-checked={egress === "shareable"} className={"atlas-chip" + (egress === "shareable" ? " on" : "")} onClick={() => setEgress("shareable")}>
                {t("atlas_egress_shareable")}
              </button>
            </div>
            <div className="atlas-hint">{t(egress === "shareable" ? "atlas_wiz_egress_share_hint" : "atlas_wiz_egress_local_hint")}</div>
            {egress === "shareable" && (
              <label className="atlas-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
                <span>{t("atlas_wiz_consent_text")}</span>
              </label>
            )}
            {egress === "shareable" && !consent && <div className="atlas-hint warn">{t("atlas_wiz_consent_required")}</div>}
          </div>
          <label className="atlas-consent">
            <input type="checkbox" checked={describe} disabled={!canDescribe} onChange={(e) => setDescribe(e.target.checked)} />
            <span>{t("atlas_wiz_describe")}</span>
          </label>
          {!canDescribe && <div className="atlas-hint">{t("atlas_desc_need_model")}</div>}
          {error && <div className="atlas-error" role="alert">{`${error.code}: ${error.msg}`}</div>}
        </div>
      )}

      {step === 4 && result && (
        <div className="atlas-wiz-body">
          <div className="atlas-hint">{t("atlas_wiz_done", { created: result.created, existing: result.existing })}</div>
          {descProgress && (
            <div className="atlas-hint">
              {descProgress.done < descProgress.total
                ? t("atlas_wiz_describe_progress", { done: descProgress.done, total: descProgress.total })
                : t("atlas_wiz_describe_done", { ok: descProgress.ok, failed: descProgress.failed })}
            </div>
          )}
        </div>
      )}

      <div className="atlas-wiz-nav">
        {step < 4 && (
          <button type="button" className="atlas-btn" onClick={() => (onDone ?? openList)()}>
            {t("atlas_wiz_cancel")}
          </button>
        )}
        {step > 1 && step < 4 && (
          <button type="button" className="atlas-btn" onClick={() => setStep((s) => (s - 1) as Step)}>
            {t("atlas_wiz_prev")}
          </button>
        )}
        {step === 1 && (
          <button type="button" className="dsbtn" disabled={selectedFigures.length === 0} onClick={() => setStep(2)}>
            {t("atlas_wiz_next")}
          </button>
        )}
        {step === 2 && (
          <button type="button" className="dsbtn" disabled={!step2Valid} onClick={() => setStep(3)}>
            {t("atlas_wiz_next")}
          </button>
        )}
        {step === 3 && (
          <button type="button" className="dsbtn" disabled={!step3Valid || busy} onClick={() => void submit()} data-testid="submit">
            {busy ? t("atlas_wiz_submitting") : t("atlas_wiz_submit", { n: totalRegions })}
          </button>
        )}
        {step === 4 && (
          <button type="button" className="dsbtn" disabled={busy} onClick={() => (onDone ?? openList)()}>
            {t("atlas_wiz_close")}
          </button>
        )}
      </div>
    </div>
  );
}

/** 已有图册联想（GET /collections）——原生 datalist。 */
function CollectionSuggest() {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    atlasApi
      .collections("all")
      .then((cc) => alive && setPaths(cc.map((c) => c.collection).filter(Boolean)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <datalist id="atlas-coll-suggest">
      {paths.map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}

/** 已有标签联想（GET /tags）——原生 datalist，零依赖。 */
function TagSuggest() {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    atlasApi
      .tags("all")
      .then((tc) => alive && setTags(tc.map((x) => x.tag)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <datalist id="atlas-tag-suggest">
      {tags.map((tg) => (
        <option key={tg} value={tg} />
      ))}
    </datalist>
  );
}
