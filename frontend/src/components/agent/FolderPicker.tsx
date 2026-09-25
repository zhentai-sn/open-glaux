import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "../../api/client";
import type { DirEntry, DirListing, ProjectView } from "../../api/types";
import { useI18n } from "../../i18n";
import { useProjects } from "../../store/projects";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 目录选择器（SDD 13 §4.1、§5.1）：浏览器弹不了原生选目录框，这里浏览的是后端所在文件系统。
// 路径框接受 POSIX、Windows 盘符、\\wsl.localhost 三种写法，由后端统一转换（§7.1 规则 8）。
export function FolderPicker({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (project: ProjectView) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const openProject = useProjects((state) => state.open);
  const [roots, setRoots] = useState<DirEntry[]>([]);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const message = (err: unknown) => (err instanceof ApiError ? err.message : t("picker_unavailable"));

  const browse = useCallback(async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.fsDirs(path);
      setListing(next);
      setInput(next.display_path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("picker_unavailable"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.fsRoots();
        setRoots(list);
        if (list[0]) await browse(list[0].path);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("picker_unavailable"));
      }
    })();
  }, [browse, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const path = input.trim();
    if (!path || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await openProject(path);
      await onOpened(project);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet folder-picker notice-enter"
        role="dialog"
        aria-modal="true"
        aria-label={t("picker_title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-hd">{t("picker_title")}</div>
        <form
          className="folder-picker-path"
          onSubmit={(event) => {
            event.preventDefault();
            void browse(input.trim());
          }}
        >
          <input
            aria-label={t("picker_path")}
            placeholder={t("picker_path_ph")}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
          <button type="submit" disabled={busy || !input.trim()}>{t("picker_go")}</button>
        </form>
        <div className="folder-picker-body">
          <nav className="folder-picker-roots" aria-label={t("picker_roots")}>
            {roots.map((root) => (
              <button
                key={root.path}
                type="button"
                title={root.display_path}
                className={listing?.path === root.path ? "on" : ""}
                onClick={() => void browse(root.path)}
              >
                <Icon icon={ICONS.folder} size="sm" />
                <span>{root.name}</span>
              </button>
            ))}
          </nav>
          <div className="folder-picker-list" aria-busy={busy}>
            {listing?.parent && (
              <button type="button" className="folder-picker-up" onClick={() => void browse(listing.parent!)}>
                <Icon icon={ICONS.back} size="sm" />
                <span>{t("picker_up")}</span>
              </button>
            )}
            {listing && !listing.entries.length && (
              <div className="folder-picker-empty">{t("picker_empty")}</div>
            )}
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                title={entry.display_path}
                onClick={() => void browse(entry.path)}
              >
                <Icon icon={ICONS.folder} size="sm" />
                <span>{entry.name}</span>
                {entry.has_children && <Icon icon={ICONS.chevronRight} size="sm" />}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="folder-picker-error" role="alert">{error}</div>}
        <div className="folder-picker-ft">
          <button type="button" onClick={onClose}>{t("picker_cancel")}</button>
          <button
            type="button"
            className="primary"
            disabled={busy || !input.trim()}
            onClick={() => void submit()}
          >
            {t("picker_open")}
          </button>
        </div>
      </div>
    </div>
  );
}
