import { useEffect, useState } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import { toConnectionInput, toViewerContext } from "../../agent/useConversation";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { errorText, useCurrentProjectId, useResourceList } from "./useResources";

// 「提示词」页（SDD 17 §5.1、§7.6）：自定义说明（GLAUX.md）、提示词模板，以及当前会话实际系统提示词预览。

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function InstructionsEditor({ scope, projectId }: { scope: "user" | "project"; projectId: string | null }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    agentRuntimeApi.getInstructions(scope, projectId)
      .then((value) => {
        if (!alive) return;
        setContent(value.content);
        setOriginal(value.content);
        setPath(value.path);
      })
      .catch((err: unknown) => alive && setStatus(errorText(err)));
    return () => { alive = false; };
  }, [scope, projectId]);

  const save = async () => {
    try {
      await agentRuntimeApi.putInstructions(scope, content, projectId);
      setOriginal(content);
      setStatus(t("res_saved"));
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  return (
    <section className="res-editor" aria-label={t(scope === "user" ? "res_instructions_user" : "res_instructions_project")}>
      <div className="res-editor-head">
        <b>{t(scope === "user" ? "res_instructions_user" : "res_instructions_project")}</b>
        {path && <span className="res-path mono" title={path}>{path}</span>}
      </div>
      <textarea
        className="res-textarea mono"
        value={content}
        placeholder={t("res_instructions_placeholder")}
        aria-label={`GLAUX.md (${scope})`}
        spellCheck={false}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="res-actions">
        <button type="button" className="btn-primary" disabled={content === original} onClick={() => void save()}>{t("res_save")}</button>
        {status && <span className="res-status" role="status">{status}</span>}
      </div>
    </section>
  );
}

interface EditingTemplate {
  source: "user" | "project";
  name: string;
  content: string;
  original: string;
  isNew?: boolean;
}

function Templates({ projectId }: { projectId: string | null }) {
  const { t } = useI18n();
  const { list, error, reload } = useResourceList(projectId);
  const [editing, setEditing] = useState<EditingTemplate | null>(null);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<"user" | "project">("user");
  const [status, setStatus] = useState<string | null>(null);
  const dirty = editing ? editing.content !== editing.original : false;
  const leave = () => !dirty || window.confirm(t("res_unsaved_confirm"));

  const open = async (source: "user" | "project", name: string) => {
    if (!leave()) return;
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
      await reload();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  return (
    <section className="res-group">
      <div className="res-group-head">{t("res_templates")}</div>
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
          disabled={!NAME.test(newName.trim())}
          onClick={() => {
            if (!leave()) return;
            setEditing({ source: newSource, name: newName.trim(), content: "", original: "", isNew: true });
            setNewName("");
          }}
        >
          <Icon icon={ICONS.plus} size="sm" /> {t("res_new_template")}
        </button>
      </div>
      {error && <div className="res-error" role="alert">{error}</div>}
      {!list?.templates.length && <div className="res-empty">{t("res_empty")}</div>}
      {list?.templates.map((item) => (
        <div key={`${item.source}-${item.name}`} className={"res-item" + (editing?.source === item.source && editing.name === item.name ? " on" : "")}>
          <button type="button" className="res-item-main" onClick={() => void open(item.source, item.name)}>
            <span className="res-item-name">/{item.name}</span>
            <span className="res-item-desc">{item.description ?? ""}</span>
          </button>
          <span className="res-badge">{t(item.source === "user" ? "res_source_user" : "res_source_project")}</span>
          {item.overridden_by && <span className="res-badge">{t("res_overridden")}</span>}
        </div>
      ))}
      {editing && (
        <section className="res-editor" aria-label={editing.name}>
          <div className="res-editor-head"><b>/{editing.name}</b></div>
          <textarea
            className="res-textarea mono"
            value={editing.content}
            aria-label={`${editing.name}.md`}
            spellCheck={false}
            onChange={(event) => setEditing({ ...editing, content: event.target.value })}
          />
          <div className="res-actions">
            <button type="button" className="btn-primary" disabled={!editing.content.trim() || (!dirty && !editing.isNew)} onClick={() => void save()}>{t("res_save")}</button>
            {!editing.isNew && <button type="button" onClick={() => void remove()}>{t("res_delete")}</button>}
            <button type="button" onClick={() => leave() && setEditing(null)}>{t("ui_close")}</button>
            {status && <span className="res-status" role="status">{status}</span>}
          </div>
        </section>
      )}
    </section>
  );
}

function Preview() {
  const { t } = useI18n();
  const sessionId = useAgentSessions((state) => state.currentSessionId);
  const connection = useSession((state) => state.connection);
  const [result, setResult] = useState<{ prompt: string; tools: string[] } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const run = async () => {
    if (!sessionId) return;
    try {
      setResult(await agentRuntimeApi.previewSystemPrompt(sessionId, toConnectionInput(connection), toViewerContext()));
      setStatus(null);
    } catch (err) {
      setStatus(errorText(err));
    }
  };
  return (
    <section className="res-group">
      <div className="res-group-head">{t("res_preview")}</div>
      <div className="res-actions">
        <button type="button" disabled={!sessionId || !connection.model.trim()} onClick={() => void run()}>{t("res_preview_run")}</button>
        {status && <span className="res-status" role="status">{status}</span>}
      </div>
      {result && (
        <>
          <div className="res-hint">{t("res_preview_tools", { tools: result.tools.join(", ") || "—" })}</div>
          <pre className="res-preview mono" data-testid="prompt-preview">{result.prompt}</pre>
        </>
      )}
    </section>
  );
}

export function PromptsView() {
  const { t } = useI18n();
  const projectId = useCurrentProjectId();
  return (
    <div className="res-view" data-testid="prompts-view">
      <div className="res-head">
        <b>{t("res_prompts_title")}</b>
        <span className="res-hint">{t("res_prompts_hint")}</span>
      </div>
      <InstructionsEditor scope="user" projectId={projectId} />
      {projectId && <InstructionsEditor key={projectId} scope="project" projectId={projectId} />}
      <Templates projectId={projectId} />
      <Preview />
    </div>
  );
}
