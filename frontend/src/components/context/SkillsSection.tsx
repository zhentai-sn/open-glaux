import { useState } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { ResourceList, ResourceSource, SkillItem } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import type { I18nKey } from "../../i18n/en";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { RESOURCE_NAME, confirmLeave, errorText, useDirtyRegistration } from "./shared";

// 「技能」分区（SDD 19 §7.3，加载与读写规则见 SDD 17）：按来源分组，列表 → 详情；
// 内置只读，可复制为用户级；修改在下一个命令生效。

const SOURCES: ResourceSource[] = ["project", "user", "builtin"];
export const SOURCE_LABEL: Record<ResourceSource, I18nKey> = {
  project: "res_source_project",
  user: "res_source_user",
  builtin: "res_source_builtin",
};

interface Editing {
  source: ResourceSource;
  name: string;
  content: string;
  original: string;
  editable: boolean;
  path?: string;
  isNew?: boolean;
}

const scaffold = (name: string) => `---\nname: ${name}\ndescription: \n---\n\n`;

export function SkillsSection({
  projectId,
  list,
  reload,
  onChanged,
}: {
  projectId: string | null;
  list: ResourceList | null;
  reload: () => Promise<void>;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newSource, setNewSource] = useState<"user" | "project">("user");
  const [newName, setNewName] = useState("");
  const dirty = editing ? editing.content !== editing.original : false;
  useDirtyRegistration("skill", dirty);
  const leave = () => confirmLeave(t("res_unsaved_confirm"));

  const open = async (item: SkillItem) => {
    try {
      const skill = await agentRuntimeApi.getSkill(item.source, item.name, projectId);
      setEditing({ source: item.source, name: item.name, content: skill.content, original: skill.content, editable: skill.editable, path: skill.path });
      setStatus(null);
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const create = () => {
    const name = newName.trim();
    if (!RESOURCE_NAME.test(name)) return;
    setEditing({ source: newSource, name, content: scaffold(name), original: "", editable: true, isNew: true });
    setNewName("");
    setStatus(null);
  };

  const save = async () => {
    if (!editing) return;
    try {
      const result = await agentRuntimeApi.putSkill(editing.source, editing.name, editing.content, projectId);
      setEditing({ ...editing, original: editing.content, isNew: false, path: result.item.path });
      setStatus(t("res_saved"));
      onChanged();
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(t("res_delete_confirm", { name: editing.name }))) return;
    try {
      await agentRuntimeApi.deleteSkill(editing.source, editing.name, projectId);
      setEditing(null);
      setStatus(null);
      onChanged();
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const toggle = async (item: SkillItem) => {
    try {
      await agentRuntimeApi.setSkillEnabled(item.name, !item.enabled);
      onChanged();
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const copyToUser = () => {
    if (!editing) return;
    setEditing({ ...editing, source: "user", original: "", editable: true, isNew: true });
    setStatus(null);
  };

  if (editing) {
    return (
      <section className="ctx-section ctx-detail" aria-label={editing.name}>
        <button type="button" className="ctx-back" onClick={() => leave() && setEditing(null)}>
          <Icon icon={ICONS.chevronLeft} size="sm" /> {t("ctx_back")}
        </button>
        <div className="res-editor">
          <div className="res-editor-head">
            <b>{editing.name}</b>
            <span className="res-badge">{t(SOURCE_LABEL[editing.source])}</span>
            {editing.path && <span className="res-path mono" title={editing.path}>{editing.path}</span>}
          </div>
          <textarea
            className="res-textarea mono ctx-textarea"
            value={editing.content}
            readOnly={!editing.editable}
            aria-label="SKILL.md"
            spellCheck={false}
            onChange={(event) => setEditing({ ...editing, content: event.target.value })}
          />
          <div className="res-actions">
            {editing.editable && (
              <button type="button" className="btn-primary" disabled={!dirty && !editing.isNew} onClick={() => void save()}>
                {t("res_save")}
              </button>
            )}
            {editing.editable && !editing.isNew && (
              <button type="button" onClick={() => void remove()}>{t("res_delete")}</button>
            )}
            {!editing.editable && (
              <button type="button" onClick={copyToUser}>{t("res_copy_to_user")}</button>
            )}
            {status && <span className="res-status" role="status">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ctx-section" data-testid="ctx-skills">
      <div className="res-new">
        <input
          value={newName}
          placeholder={t("res_new_name")}
          aria-label={t("res_new_name")}
          onChange={(event) => setNewName(event.target.value)}
        />
        {projectId && (
          <select value={newSource} aria-label={t("res_new_source")} onChange={(event) => setNewSource(event.target.value as "user" | "project")}>
            <option value="user">{t("res_source_user")}</option>
            <option value="project">{t("res_source_project")}</option>
          </select>
        )}
        <button type="button" disabled={!RESOURCE_NAME.test(newName.trim())} onClick={create}>
          <Icon icon={ICONS.plus} size="sm" /> {t("res_new_skill")}
        </button>
      </div>
      {status && <div className="res-error" role="alert">{status}</div>}
      {list?.diagnostics.map((d) => (
        <div className="res-warning" key={`${d.path}-${d.code}`} role="status">
          <Icon icon={ICONS.warning} size="sm" /> {d.message} <span className="mono">{d.path}</span>
        </div>
      ))}
      {SOURCES.filter((source) => source !== "project" || projectId).map((source) => {
        const items = (list?.skills ?? []).filter((skill) => skill.source === source);
        return (
          <section key={source} className="res-group">
            <div className="res-group-head">{t(SOURCE_LABEL[source])}</div>
            {!items.length && <div className="res-empty">{t("res_empty")}</div>}
            {items.map((item) => (
              <div key={`${item.source}-${item.name}`} className="res-item">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  aria-label={t("res_enabled", { name: item.name })}
                  onChange={() => void toggle(item)}
                />
                <button type="button" className="res-item-main" onClick={() => void open(item)}>
                  <span className="res-item-name">{item.name}</span>
                  <span className="res-item-desc">{item.description}</span>
                </button>
                {item.overridden_by && <span className="res-badge">{t("res_overridden")}</span>}
                {!item.model_invocable && <span className="res-badge">{t("res_manual_only")}</span>}
              </div>
            ))}
          </section>
        );
      })}
    </section>
  );
}
