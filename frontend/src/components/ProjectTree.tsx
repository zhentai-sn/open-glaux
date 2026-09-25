import { useEffect, useState } from "react";

import { ApiError, api } from "../api/client";
import type { ObjectMeta, ProjectEntry } from "../api/types";
import { openObject, openProjectFile } from "../data/actions";
import { displayName } from "../data/objectInfo";
import { useI18n } from "../i18n";
import { useModalityLabel } from "../i18n/modalityLabel";
import { useProjects } from "../store/projects";
import { useSession } from "../store/session";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 项目目录树（SDD 13 §5.1、§7.2、§7.8 规则 1）：打开项目不扫描，展开一层列一层；
// 可识别文件（按后缀有候选模态）点击后由后端校验并按需登记，再走 openObject。
const BATCH = 200; // 单层条目过多时分批渲染（§13）

const indent = (depth: number) => ({ paddingLeft: depth * 12 + 4 });

function FileLeaf({ projectId, entry, depth }: { projectId: string; entry: ProjectEntry; depth: number }) {
  const { t } = useI18n();
  const label = useModalityLabel();
  const focusId = useSession((s) => s.focus?.object_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(entry.object_id);
  const selected = !!openedId && openedId === focusId;

  if (!entry.modality) {
    return (
      <div className="row ptree-unknown" style={indent(depth)} title={t("ptree_unsupported")}>
        <span className="tw" />
        <Icon icon={ICONS.file} size="sm" className="ico fico" />
        <span className="nm">{entry.name}</span>
      </div>
    );
  }

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await openProjectFile(projectId, entry.path);
      setOpenedId(meta.id);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "unsupported_format"
          ? t("ptree_unsupported_format")
          : code === "corrupt"
            ? t("ptree_corrupt")
            : err instanceof Error
              ? err.message
              : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={"row" + (selected ? " sel" : "")}
        style={indent(depth)}
        title={`${entry.path} · ${label(entry.modality)}`}
        aria-pressed={selected}
        aria-busy={busy || undefined}
        onClick={() => void open()}
      >
        <span className="tw" />
        <Icon icon={busy ? ICONS.spinner : ICONS.file} size="sm" className="ico fico" />
        <span className="nm">{entry.name}</span>
        {selected && <Icon icon={ICONS.check} size="sm" className="dot" />}
      </button>
      {error && (
        <div className="row ptree-error" style={indent(depth + 1)} role="alert">
          <span className="nm">{error}</span>
        </div>
      )}
    </>
  );
}

function DirNode({
  projectId,
  name,
  path,
  depth,
  defaultOpen,
}: {
  projectId: string;
  name: string;
  path: string;
  depth: number;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!!defaultOpen);
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(BATCH);

  useEffect(() => {
    if (!open || entries) return;
    let alive = true;
    api
      .projectEntries(projectId, path)
      .then((r) => alive && setEntries(r.entries))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [open, entries, projectId, path]);

  const shown = entries?.slice(0, limit) ?? [];
  const rest = (entries?.length ?? 0) - shown.length;

  return (
    <>
      <button
        type="button"
        className="row"
        style={indent(depth)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="tw"><Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" /></span>
        <Icon icon={ICONS.folder} size="sm" className="ico" />
        <span className="nm">{name}</span>
      </button>
      {open && !entries && !error && (
        <div className="row" style={indent(depth + 1)} aria-busy="true">
          <span className="tw" />
          <span className="nm ptree-faint">{t("ptree_loading")}</span>
        </div>
      )}
      {open && error && (
        <div className="row ptree-error" style={indent(depth + 1)} role="alert">
          <span className="nm">{error}</span>
        </div>
      )}
      {open && entries && !entries.length && (
        <div className="row" style={indent(depth + 1)}>
          <span className="tw" />
          <span className="nm ptree-faint">{t("ptree_empty")}</span>
        </div>
      )}
      {open &&
        shown.map((entry) =>
          entry.type === "dir" ? (
            <DirNode key={entry.path} projectId={projectId} name={entry.name} path={entry.path} depth={depth + 1} />
          ) : (
            <FileLeaf key={entry.path} projectId={projectId} entry={entry} depth={depth + 1} />
          ),
        )}
      {open && rest > 0 && (
        <button type="button" className="row" style={indent(depth + 1)} onClick={() => setLimit((n) => n + BATCH)}>
          <span className="tw" />
          <span className="nm ptree-faint">{t("ptree_more", { n: rest })}</span>
        </button>
      )}
    </>
  );
}

/** 虚拟节点「上传」：本项目上传源的对象（上传落盘在数据集根下，不在项目目录里，§7.8 规则 5）。 */
function UploadsNode({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const datasources = useSession((s) => s.datasources);
  const objects = useSession((s) => s.objects);
  const focusId = useSession((s) => s.focus?.object_id ?? null);
  const [open, setOpen] = useState(true);
  const sources = datasources.filter(
    (d) => d.project_id === projectId && d.origin !== "project" && d.status === "active",
  );
  const ids = new Set(sources.map((d) => d.id));
  const modalities = [...new Set(sources.map((d) => d.modality))];
  // 以拼接串为依赖：modalities 每次渲染都是新数组
  const modalityKey = modalities.join("|");

  useEffect(() => {
    for (const m of modalityKey ? modalityKey.split("|") : []) {
      if (useSession.getState().objects[m]) continue;
      void api.objects(m).then((list) => useSession.getState().setObjects(m, list)).catch(() => undefined);
    }
  }, [modalityKey]);

  if (!sources.length) return null;
  const list: ObjectMeta[] = modalities.flatMap((m) => (objects[m] ?? []).filter((o) => ids.has(o.source_id)));

  return (
    <>
      <button type="button" className="row" style={indent(0)} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tw"><Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" /></span>
        <Icon icon={ICONS.folder} size="sm" className="ico" />
        <span className="nm">{t("ptree_uploads")}</span>
      </button>
      {open &&
        list.map((o) => (
          <button
            key={o.id}
            type="button"
            className={"row" + (focusId === o.id ? " sel" : "")}
            style={indent(1)}
            aria-pressed={focusId === o.id}
            onClick={() => void openObject(o.id, o.modality)}
          >
            <span className="tw" />
            <Icon icon={ICONS.file} size="sm" className="ico fico" />
            <span className="nm">{displayName(o)}</span>
          </button>
        ))}
    </>
  );
}

export function ProjectTree({ projectId }: { projectId: string }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const [reload, setReload] = useState(0);
  const { t } = useI18n();
  if (!project) return null;
  return (
    <div className="ptree">
      <div className="exp-head">
        <span className="ws" title={project.display_path}>{project.name}</span>
        <button
          type="button"
          className="exp-add"
          title={t("ptree_refresh")}
          aria-label={t("ptree_refresh")}
          onClick={() => setReload((n) => n + 1)}
        >
          <Icon icon={ICONS.regenerate} size="sm" />
        </button>
      </div>
      {project.status === "missing" ? (
        <div className="row ptree-error" role="alert">
          <span className="nm">{t("project_missing")}</span>
        </div>
      ) : (
        <div key={reload}>
          <UploadsNode projectId={projectId} />
          <DirNode projectId={projectId} name={project.name} path="" depth={0} defaultOpen />
        </div>
      )}
    </div>
  );
}
