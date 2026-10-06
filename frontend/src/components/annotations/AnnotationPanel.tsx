import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import type { Annotation, AnnotationSummary, Label, SummaryGroup } from "../../api/types";
import { confirmSuggestion, loadAnnotations, relabelAnnotation, removeAnnotation, resolveSuggestion } from "../../annotation/bridge";
import { annotationColor } from "../../annotation/labelStyle";
import { formatArea } from "../../annotation/units";
import { useI18n } from "../../i18n";
import type { I18nKey } from "../../i18n/en";
import { useLabels } from "../../store/labels";
import { activeObject, useSession } from "../../store/session";

// 标注面板（SDD 23 §7.6）：当前对象的标注按标签分组计数与汇总面积，以及标签目录管理。
// 汇总取 backend `/annotations/summary`（与 list_annotations 同源，数字一致）；
// 「当前层或帧」的列表直接用 store，「全部」时另取一次不带索引的列表。

type Section = "annotations" | "labels";
type Scope = "current" | "all";

const SHAPE_KEY: Record<string, I18nKey> = {
  bbox: "ann_shape_bbox",
  polyline: "ann_shape_polygon",
  mask: "ann_shape_mask",
  point: "ann_shape_point",
};
const STATUS_KEY: Record<Annotation["status"], I18nKey> = {
  draft: "ann_status_draft",
  confirmed: "ann_status_confirmed",
  suggested: "ann_status_suggested",
  rejected: "ann_status_rejected",
};
const SOURCE_KEY: Record<Annotation["source"], I18nKey> = {
  manual: "ann_source_manual",
  agent: "ann_source_agent",
  model: "ann_source_model",
};

/** 与汇总分组对应的键：目录标签按 id，未入目录按文本，未打标签为空。 */
function groupKeyOf(a: Pick<Annotation, "label_id" | "label">): string {
  if (a.label_id) return `c:${a.label_id}`;
  return a.label.trim() ? `u:${a.label.trim()}` : "n:";
}
function groupKey(g: SummaryGroup): string {
  return g.kind === "catalog" ? `c:${g.label_id}` : g.kind === "uncatalogued" ? `u:${g.name}` : "n:";
}

export function AnnotationPanel() {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("annotations");
  const object = useSession((s) => activeObject(s));
  return (
    <div className="ann-panel" data-testid="annotation-panel">
      <div className="ann-tabs" role="tablist">
        <button role="tab" aria-selected={section === "annotations"} onClick={() => setSection("annotations")}>{t("ann_tab_annotations")}</button>
        <button role="tab" aria-selected={section === "labels"} onClick={() => setSection("labels")}>{t("ann_tab_labels")}</button>
      </div>
      {!object ? (
        <div className="ann-empty">{t("ann_no_object")}</div>
      ) : section === "annotations" ? (
        <AnnotationsSection objectId={object.id} thirdAxis={object.axes.find((a) => a.name === "z" || a.name === "t")?.name as "z" | "t" | undefined} />
      ) : (
        <LabelsSection objectId={object.id} />
      )}
    </div>
  );
}

function AnnotationsSection({ objectId, thirdAxis }: { objectId: string; thirdAxis?: "z" | "t" }) {
  const { t } = useI18n();
  const focus = useSession((s) => s.focus);
  const stored = useSession((s) => s.annotations);
  const setIndex = useSession((s) => s.setIndex);
  const locateAnnotation = useLabels((s) => s.locateAnnotation);
  const loadLabels = useLabels((s) => s.load);
  const loadedFor = useLabels((s) => s.objectId);
  const [scope, setScope] = useState<Scope>("current");
  const [summary, setSummary] = useState<AnnotationSummary | null>(null);
  const [allRows, setAllRows] = useState<Annotation[] | null>(null);
  const at = thirdAxis && scope === "current" ? focus?.index[thirdAxis] ?? null : null;

  useEffect(() => {
    if (loadedFor !== objectId) void loadLabels(objectId);
  }, [objectId, loadedFor, loadLabels]);

  // 智能体的建议经工具事件直接写入 store，不带 backend 算的面积：发现这类条目时重取一次列表
  const missingMeasures = stored.some((a) => a.image_id === objectId && !a.id.startsWith("tmp-") && a.measures === undefined);
  useEffect(() => {
    if (missingMeasures && focus?.object_id === objectId) void loadAnnotations(objectId, focus.index);
  }, [missingMeasures, objectId, focus]);

  // 标注一变就重取汇总（及「全部」列表）；连续编辑合并为一次
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.annotations.summary(objectId, at).then((s) => { if (!cancelled) setSummary(s); }).catch(() => undefined);
      if (scope === "all") {
        void api.annotations.list(objectId).then((r) => { if (!cancelled) setAllRows(r.annotations); }).catch(() => undefined);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [objectId, at, scope, stored]);

  const rows = useMemo(
    () => (scope === "all" && allRows ? allRows : stored).filter((a) => a.image_id === objectId && a.status !== "rejected" && !a.id.startsWith("tmp-")),
    [scope, allRows, stored, objectId],
  );
  const byGroup = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of rows) {
      const k = groupKeyOf(a);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [rows]);

  const locate = useCallback((a: Annotation) => {
    const idx = thirdAxis ? a.index?.[thirdAxis] : undefined;
    if (thirdAxis && idx != null && focus?.index[thirdAxis] !== idx) setIndex({ [thirdAxis]: idx });
    locateAnnotation(a.id);
  }, [thirdAxis, focus, setIndex, locateAnnotation]);

  const unit = summary?.area_unit ?? "px2";
  const groupName = (g: SummaryGroup) =>
    g.kind === "unlabeled" ? t("ann_group_unlabeled") : g.kind === "uncatalogued" ? t("ann_group_uncatalogued", { name: g.name }) : g.name;

  return (
    <div className="ann-section">
      {thirdAxis && (
        <div className="ann-scope" role="radiogroup" aria-label={t("ann_scope")}>
          <button aria-pressed={scope === "current"} onClick={() => setScope("current")}>{t(thirdAxis === "t" ? "ann_scope_frame" : "ann_scope_slice")}</button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>{t("ann_scope_all")}</button>
        </div>
      )}
      {summary && summary.groups.length > 0 ? (
        <>
          <table className="ann-summary" data-testid="ann-summary">
            <thead>
              <tr><th>{t("ann_col_label")}</th><th>{t("ann_col_count")}</th><th>{t("ann_col_area")}</th></tr>
            </thead>
            <tbody>
              {summary.groups.map((g) => (
                <tr key={groupKey(g)}>
                  <td>
                    <span className={g.color ? "label-swatch" : "label-swatch none"} style={g.color ? { background: g.color } : undefined} />
                    <span className="label-name">{groupName(g)}</span>
                  </td>
                  <td className="num">
                    {g.count}
                    {g.suggested > 0 && <span className="ann-pending" title={t("ann_pending_title")}>+{g.suggested}</span>}
                  </td>
                  <td className="num">{formatArea(g.area, unit)}</td>
                </tr>
              ))}
              <tr className="ann-total">
                <td>{t("ann_total")}</td>
                <td className="num">{summary.total.count}{summary.total.suggested > 0 && <span className="ann-pending">+{summary.total.suggested}</span>}</td>
                <td className="num">{formatArea(summary.total.area, unit)}</td>
              </tr>
            </tbody>
          </table>
          <div className="ann-note">{t("ann_area_note")}</div>
          {summary.groups.map((g) => (
            <div key={groupKey(g)} className="ann-group">
              <div className="ann-group-head">
                <span className={g.color ? "label-swatch" : "label-swatch none"} style={g.color ? { background: g.color } : undefined} />
                <span className="label-name">{groupName(g)}</span>
              </div>
              <ul className="ann-list">
                {(byGroup.get(groupKey(g)) ?? []).map((a) => (
                  <AnnotationRow key={a.id} a={a} onLocate={() => locate(a)} />
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <div className="ann-empty">{t("ann_none")}</div>
      )}
    </div>
  );
}

function AnnotationRow({ a, onLocate }: { a: Annotation; onLocate: () => void }) {
  const { t } = useI18n();
  const idx = Object.entries(a.index ?? {}).filter(([k]) => k !== "level").map(([k, v]) => `${k} ${(v as number) + 1}`).join(" ");
  return (
    <li className="ann-row" data-testid="ann-row">
      <button className="ann-row-main" onClick={onLocate} title={t("ann_locate")}>
        <span className="ann-dot" style={{ background: annotationColor(a) }} />
        <span>{t(SHAPE_KEY[a.primitive.kind] ?? "ann_shape_bbox")}{idx && <span className="ann-idx"> · {idx}</span>}</span>
        <span className={`ann-status ${a.status}`}>{t(STATUS_KEY[a.status])}</span>
        <span className="ann-source">{t(SOURCE_KEY[a.source])}</span>
        <span className="num">{a.measures ? formatArea(a.measures.area, a.measures.area_unit) : "—"}</span>
      </button>
      <div className="ann-row-actions">
        <button className="ann-act" onClick={() => void relabelAnnotation(a)}>{t("ann_relabel")}</button>
        {a.status === "suggested" ? (
          <>
            <button className="ann-act" onClick={() => void confirmSuggestion(a)}>{t("suggestion_confirm")}</button>
            <button className="ann-act" onClick={() => void resolveSuggestion(a.id, a.seq, "rejected")}>{t("suggestion_reject")}</button>
          </>
        ) : a.source === "manual" ? (
          <button className="ann-act danger" onClick={() => void removeAnnotation(a.id, a.seq)}>{t("ann_delete")}</button>
        ) : null}
      </div>
    </li>
  );
}

function LabelsSection({ objectId }: { objectId: string }) {
  const { t } = useI18n();
  const { labels, load, objectId: loadedFor, createLabel } = useLabels();
  const [name, setName] = useState("");
  useEffect(() => {
    if (loadedFor !== objectId) void load(objectId);
  }, [objectId, loadedFor, load]);

  const add = async () => {
    if (!name.trim()) return;
    if (await createLabel(objectId, name.trim())) setName("");
  };

  return (
    <div className="ann-section">
      <form className="ann-new-label" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={name} placeholder={t("ann_new_label")} aria-label={t("ann_new_label")} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>{t("ann_add")}</button>
      </form>
      {labels.length === 0 ? (
        <div className="ann-empty">{t("ann_no_labels")}</div>
      ) : (
        <ul className="label-list">
          {labels.map((label, i) => (
            <LabelRow key={label.id} label={label} labels={labels} first={i === 0} last={i === labels.length - 1} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LabelRow({ label, labels, first, last }: { label: Label; labels: Label[]; first: boolean; last: boolean }) {
  const { t } = useI18n();
  const { updateLabel, deleteLabel, mergeLabel } = useLabels();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label.name);
  const [description, setDescription] = useState(label.description);
  const [blocked, setBlocked] = useState<number | null>(null);

  const save = async () => {
    const patch: { name?: string; description?: string } = {};
    if (draft.trim() && draft.trim() !== label.name) patch.name = draft.trim();
    if (description.trim() !== label.description) patch.description = description.trim();
    if (Object.keys(patch).length === 0 || (await updateLabel(label.id, patch))) setEditing(false);
  };

  const neighbour = (dir: -1 | 1) => labels[labels.indexOf(label) + dir];
  const move = async (dir: -1 | 1) => {
    const other = neighbour(dir);
    if (!other) return;
    // 交换两者的 sort；sort 相同（旧数据）时按位置给出新值
    const [a, b] = label.sort === other.sort ? [labels.indexOf(other), labels.indexOf(label)] : [other.sort, label.sort];
    await updateLabel(label.id, { sort: a });
    await updateLabel(other.id, { sort: b });
  };

  return (
    <li className="label-row" data-testid="label-row">
      <div className="label-row-main">
        <input
          type="color"
          className="label-color"
          value={label.color.toLowerCase()}
          aria-label={t("ann_label_color")}
          onChange={(e) => void updateLabel(label.id, { color: e.target.value })}
        />
        {editing ? (
          <input className="label-rename" value={draft} autoFocus aria-label={t("ann_rename")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} />
        ) : (
          <button className="label-name-btn" title={t("ann_rename")} onClick={() => { setDraft(label.name); setDescription(label.description); setEditing(true); }}>
            {label.name}
          </button>
        )}
        <span className="label-count">{t("ann_label_count", { n: label.count })}</span>
        <button className="ann-act" disabled={first} aria-label={t("ann_move_up")} onClick={() => void move(-1)}>↑</button>
        <button className="ann-act" disabled={last} aria-label={t("ann_move_down")} onClick={() => void move(1)}>↓</button>
        <button
          className="ann-act danger"
          disabled={label.count > 0}
          title={label.count > 0 ? t("ann_delete_blocked", { n: label.count }) : undefined}
          onClick={async () => {
            const r = await deleteLabel(label.id);
            if (!r.ok && r.count) setBlocked(r.count);
          }}
        >
          {t("ann_delete")}
        </button>
      </div>
      {editing && (
        <div className="label-row-edit">
          <input value={description} placeholder={t("ann_label_description")} aria-label={t("ann_label_description")}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          <button className="ann-act" onClick={() => void save()}>{t("ann_save")}</button>
        </div>
      )}
      {!editing && label.description && <div className="label-desc">{label.description}</div>}
      {labels.length > 1 && (
        <label className="label-merge">
          {t("ann_merge_into")}
          <select value="" onChange={(e) => { if (e.target.value) void mergeLabel(label.id, e.target.value); }}>
            <option value="">—</option>
            {labels.filter((l) => l.id !== label.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      {blocked !== null && <div className="label-blocked">{t("ann_delete_blocked", { n: blocked })}</div>}
    </li>
  );
}
