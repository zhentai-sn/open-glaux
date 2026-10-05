import { useEffect, useState } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { PromptSegment } from "../../agent/runtime/types";
import { useI18n, type I18nKey } from "../../i18n";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { errorText, useDirtyRegistration, type PreviewState } from "./shared";

// 「系统提示词」分区（SDD 19 §5.1、§7.4）：两层 GLAUX.md 编辑与分段预览。

function InstructionsEditor({ scope, projectId, onSaved }: { scope: "user" | "project"; projectId: string | null; onSaved: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useDirtyRegistration(`instructions:${scope}`, content !== original);

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
      onSaved();
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const label = t(scope === "user" ? "res_instructions_user" : "res_instructions_project");
  return (
    <section className="res-editor" aria-label={label}>
      <div className="res-editor-head">
        <b>{label}</b>
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

const SEGMENT_LABEL: Record<PromptSegment["kind"], I18nKey> = {
  base: "ctx_seg_base",
  plugin: "ctx_seg_plugin",
  instructions: "ctx_seg_instructions_user",
  skills: "ctx_seg_skills",
  viewer: "ctx_seg_viewer",
};

export function segmentLabel(
  t: (key: I18nKey, vars?: Record<string, string | number>) => string,
  segment: Pick<PromptSegment, "kind" | "plugin" | "scope">,
): string {
  if (segment.kind === "instructions") return t(segment.scope === "project" ? "ctx_seg_instructions_project" : "ctx_seg_instructions_user");
  return t(SEGMENT_LABEL[segment.kind], { plugin: segment.plugin ?? "" });
}

/** 分段列表：来源标签、估算 token，可展开正文（SDD 19 §7.4 规则 4）；运行轨迹的请求头详情复用（SDD 21 §7.4）。 */
export function SegmentList({ segments, readonlyBadges = false }: { segments: PromptSegment[]; readonlyBadges?: boolean }) {
  const { t } = useI18n();
  return (
    <ul className="ctx-segments">
      {segments.map((segment, index) => (
        <li key={index}>
          <details className="ctx-segment">
            <summary>
              <span className="ctx-segment-label">{segmentLabel(t, segment)}</span>
              {readonlyBadges && (segment.kind === "base" || segment.kind === "plugin" || segment.kind === "viewer") && (
                <span className="res-badge">{t("ctx_readonly")}</span>
              )}
              <span className="ctx-tokens">{t("ctx_tokens", { n: segment.est_tokens })}</span>
            </summary>
            <pre className="res-preview mono">{segment.text}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** 预览不可用时的说明（SDD 19 §7.4 规则 2、3）；有结果时返回 null。 */
export function PreviewNotice({ state }: { state: PreviewState }) {
  const { t } = useI18n();
  const uiMode = useSession((s) => s.uiMode);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  if (state.status === "no-session") return <div className="res-empty">{t("ctx_preview_no_session")}</div>;
  if (state.status === "no-model") {
    return (
      <div className="res-empty">
        {uiMode === "focus" ? (
          <button type="button" className="ctx-link" onClick={() => setFocusLayout({ rightOpen: true, sideView: "settings" })}>
            {t("ctx_preview_no_model")}
          </button>
        ) : t("ctx_preview_no_model")}
      </div>
    );
  }
  if (state.status === "error") return <div className="res-error" role="alert">{state.error}</div>;
  if (state.status === "outdated") return <div className="res-error" role="alert">{t("ctx_preview_outdated")}</div>;
  if (state.status === "loading" && !state.data) return <div className="res-empty" aria-busy="true">{t("ctx_preview_loading")}</div>;
  return null;
}

/** 刷新按钮与「内容已变化」提示。 */
export function PreviewToolbar({ state, onRefresh }: { state: PreviewState; onRefresh: () => void }) {
  const { t } = useI18n();
  const canRefresh = state.status === "ready" || state.status === "error" || state.status === "outdated" || state.status === "loading";
  return (
    <div className="res-actions">
      <button type="button" disabled={!canRefresh || state.status === "loading"} onClick={onRefresh}>
        <Icon icon={ICONS.regenerate} size="sm" /> {t("ctx_preview_refresh")}
      </button>
      {state.status === "ready" && state.stale && <span className="res-status" role="status">{t("ctx_preview_stale")}</span>}
    </div>
  );
}

function Preview({ state, onRefresh }: { state: PreviewState; onRefresh: () => void }) {
  const { t } = useI18n();
  const [full, setFull] = useState(false);
  const data = state.status === "ready" || state.status === "loading" ? state.data : undefined;
  return (
    <section className="res-group ctx-preview" aria-label={t("res_preview")}>
      <div className="res-group-head">{t("res_preview")}</div>
      <PreviewToolbar state={state} onRefresh={onRefresh} />
      <PreviewNotice state={state} />
      {data && (
        <>
          <div className="ctx-totals" data-testid="prompt-totals">
            {t("ctx_tokens_total", {
              prompt: data.est_tokens.prompt,
              tools: data.est_tokens.tools,
              total: data.est_tokens.prompt + data.est_tokens.tools,
            })}
          </div>
          <SegmentList segments={data.segments} readonlyBadges />
          <div className="res-actions">
            <button type="button" aria-expanded={full} onClick={() => setFull((v) => !v)}>
              {t(full ? "ctx_preview_hide_full" : "ctx_preview_show_full")}
            </button>
          </div>
          {full && <pre className="res-preview mono" data-testid="prompt-preview">{data.prompt}</pre>}
        </>
      )}
    </section>
  );
}

export function SystemSection({
  projectId,
  preview,
  onRefresh,
  onChanged,
}: {
  projectId: string | null;
  preview: PreviewState;
  onRefresh: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="ctx-section" data-testid="ctx-system">
      <InstructionsEditor scope="user" projectId={projectId} onSaved={onChanged} />
      {projectId && <InstructionsEditor key={projectId} scope="project" projectId={projectId} onSaved={onChanged} />}
      <Preview state={preview} onRefresh={onRefresh} />
    </div>
  );
}
