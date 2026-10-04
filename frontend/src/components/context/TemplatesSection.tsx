import { useState } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { ResourceList } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { RESOURCE_NAME, confirmLeave, errorText, useDirtyRegistration } from "./shared";

// 「提示词模板」分区（SDD 19 §7.3）：列表 → 详情；模板只供用户以 /名称 显式调用（SDD 17 §7.4）。

interface EditingTemplate {
  source: "user" | "project";
  name: string;
  content: string;
  original: string;
  isNew?: boolean;
}

export function TemplatesSection({
  projectId,
  list,
  reload,
}: {
  projectId: string | null;
  list: ResourceList | null;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<EditingTemplate | null>(null);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<"user" | "project">("user");
  const [status, setStatus] = useState<string | null>(null);
  const dirty = editing ? editing.content !== editing.original : false;
  useDirtyRegistration("template", dirty);
  const leave = () => confirmLeave(t("res_unsaved_confirm"));

  const open = async (source: "user" | "project", name: string) => {
    try {
      const template = await agentRuntimeApi.getTemplate(source, name, projectId);
      setEditing({ source, name, content: template.content, original: template.content });
      setStatus(null);
    } catch (err) {
      setStatus(errorText(err));
    }
  };
  const save = async () => {
    if (!editing) return;
    try {
      await agentRuntimeApi.putTemplate(editing.source, editing.name, editing.content, projectId);
      setEditing({ ...editing, original: editing.content, isNew: false });
      setStatus(t("res_saved"));
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };
  const remove = async () => {
    if (!editing || !window.confirm(t("res_delete_confirm", { name: editing.name }))) return;
    try {
      await agentRuntimeApi.deleteTemplate(editing.source, editing.name, projectId);
      setEditing(null);
      setStatus(null);
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  if (editing) {
    return (
      <section className="ctx-section ctx-detail" aria-label={`/${editing.name}`}>
        <button type="button" className="ctx-back" onClick={() => leave() && setEditing(null)}>
          <Icon icon={ICONS.chevronLeft} size="sm" /> {t("ctx_back")}
        </button>
        <div className="res-editor">
          <div className="res-editor-head">
            <b>/{editing.name}</b>
            <span className="res-badge">{t(editing.source === "user" ? "res_source_user" : "res_source_project")}</span>
          </div>
          <textarea
            className="res-textarea mono ctx-textarea"
            value={editing.content}
            aria-label={`${editing.name}.md`}
            spellCheck={false}
            onChange={(event) => setEditing({ ...editing, content: event.target.value })}
          />
          <div className="res-actions">
            <button type="button" className="btn-primary" disabled={!editing.content.trim() || (!dirty && !editing.isNew)} onClick={() => void save()}>{t("res_save")}</button>
            {!editing.isNew && <button type="button" onClick={() => void remove()}>{t("res_delete")}</button>}
            {status && <span className="res-status" role="status">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ctx-section" data-testid="ctx-templates">
      <div className="res-hint">{t("res_templates_hint")}</div>
      <div className="res-new">
        <input value={newName} placeholder={t("res_new_name")} aria-label={t("res_new_template_name")} onChange={(event) => setNewName(event.target.value)} />
        {projectId && (
          <select value={newSource} aria-label={t("res_new_source")} onChange={(event) => setNewSource(event.target.value as "user" | "project")}>
            <option value="user">{t("res_source_user")}</option>
            <option value="project">{t("res_source_project")}</option>
          </select>
        )}
        <button
          type="button"
          disabled={!RESOURCE_NAME.test(newName.trim())}
          onClick={() => {
            setEditing({ source: newSource, name: newName.trim(), content: "", original: "", isNew: true });
            setNewName("");
            setStatus(null);
          }}
        >
          <Icon icon={ICONS.plus} size="sm" /> {t("res_new_template")}
        </button>
      </div>
      {status && <div className="res-error" role="alert">{status}</div>}
      {!list?.templates.length && <div className="res-empty">{t("res_empty")}</div>}
      {list?.templates.map((item) => (
        <div key={`${item.source}-${item.name}`} className="res-item">
          <button type="button" className="res-item-main" onClick={() => void open(item.source, item.name)}>
            <span className="res-item-name">/{item.name}</span>
            <span className="res-item-desc">{item.description ?? ""}</span>
          </button>
          <span className="res-badge">{t(item.source === "user" ? "res_source_user" : "res_source_project")}</span>
          {item.overridden_by && <span className="res-badge">{t("res_overridden")}</span>}
        </div>
      ))}
    </section>
  );
}
