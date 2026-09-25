import { useId, useState, type ReactNode } from "react";

import { AgentRuntimeError, agentRuntimeApi } from "../../agent/runtime/client";
import { toProbeInput } from "../../agent/useConversation";
import type { VlmModelInfo, VlmProvider } from "../../api/types";
import { useI18n, type I18nKey } from "../../i18n";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  type Connection,
  useSession,
} from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { Segmented } from "../Segmented";

const LOCAL_PRESETS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
] as const;
const MODEL_LIST_ID = "glaux-model-options";

type MediaAdapter = NonNullable<Connection["mediaAdapter"]>;
type T = (key: I18nKey, vars?: Record<string, string | number>) => string;

function optionalInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 200000 → 200K、32768 → 32K（1024 的整数倍按二进制 K）；1000 以下原样。 */
function compact(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

/**
 * 选中模型时补齐上下文元数据（SDD 00 §4）：上游自报值优先，探不到落默认值。
 * 只在字段为空时兜底默认值——用户手改过的数字不覆盖；上游有明确值则以上游为准。
 */
function metaForModel(model: VlmModelInfo | undefined, current: Connection) {
  const contextWindow =
    model?.context_window ?? current.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const wanted = model?.max_tokens ?? current.maxTokens ?? DEFAULT_MAX_TOKENS;
  // runtime 要求 max_tokens < context_window：窗口小于默认输出时按 1/4 收窄，别把用户卡在 400。
  const maxTokens =
    wanted < contextWindow ? wanted : Math.max(1, Math.floor(contextWindow / 4));
  return { contextWindow, maxTokens };
}

/** 左标签右控件的一行；htmlFor 把标签绑到输入框，填了值也能看出字段含义。 */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cfg-field">
      {htmlFor ? (
        <label className="cfg-label" htmlFor={htmlFor}>{label}</label>
      ) : (
        <span className="cfg-label">{label}</span>
      )}
      <div className="cfg-control">
        {children}
        {hint && <div className="cfg-hint">{hint}</div>}
      </div>
    </div>
  );
}

/**
 * 连接状态卡：常驻显示是否已配置、上次测试结果与当前模型；测试按钮在卡内。
 * 改了 provider / 地址 / 密钥 / 模型会清掉 lastTest，状态回到「未测试」，不显示过期的通过结论。
 */
function StatusCard({
  connection,
  testing,
  onTest,
  t,
}: {
  connection: Connection;
  testing: boolean;
  onTest: () => void;
  t: T;
}) {
  const oai = connection.provider === "openai_compatible";
  const configured = oai ? connection.baseUrl.trim() !== "" : connection.apiKey.trim() !== "";
  const test = connection.lastTest;
  const state = !configured ? "unset" : !test ? "untested" : test.ok ? "ok" : "fail";
  const providerLabel = oai ? t("cfg_openai_compat") : "Anthropic";
  const model = connection.model || t("cfg_default_model");
  const count = connection.models?.length;
  const time = test ? new Date(test.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  const title =
    state === "unset" ? t("cfg_status_unconfigured")
    : state === "untested" ? t("cfg_status_untested")
    : state === "ok" ? `${t("cfg_connected")} · ${model}`
    : t("cfg_status_fail");
  const meta =
    state === "unset" ? t(oai ? "cfg_status_need_url" : "cfg_status_need_key")
    : state === "untested" ? `${providerLabel} · ${model}`
    : state === "ok"
      ? [providerLabel, count ? t("cfg_n_models", { n: count }) : null, t("cfg_status_passed_at", { time })]
          .filter(Boolean)
          .join(" · ")
      : test?.reason ?? "";

  return (
    <div className={`cfg-status ${state}`} role="status">
      <span className="cfg-status-dot" aria-hidden="true" />
      <div className="cfg-status-text">
        <div className="cfg-status-title">{title}</div>
        {meta && <div className="cfg-status-meta">{meta}</div>}
      </div>
      <button className="cfgbtn cfg-status-btn" type="button" disabled={testing} onClick={onTest}>
        {testing ? "…" : t(state === "ok" || state === "fail" ? "cfg_retest" : "cfg_test")}
      </button>
    </div>
  );
}

/**
 * 模型与连接表单（SDD feats/01 v1.7 D23 / D26）：状态卡 + 服务 / 模型 / 能力 / 高级四组。
 * popover：Workbench 对话面板的浮层（带标题与关闭钮，标签叠在控件上方）；
 * panel：嵌进 Focus 设置面板「模型与连接」分区（左标签右控件），标题与关闭由面板负责。
 */
export function ConnectionConfig({
  onClose,
  variant = "popover",
}: {
  onClose?: () => void;
  variant?: "popover" | "panel";
}) {
  const { t } = useI18n();
  const connection = useSession((state) => state.connection);
  const setConnection = useSession((state) => state.setConnection);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ tone: "good" | "warn" | "crit"; text: string } | null>(null);
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;

  const oai = connection.provider === "openai_compatible";
  const models = connection.models ?? [];

  const errorText = (error: unknown) =>
    error instanceof AgentRuntimeError ? error.message : String(error);

  // 影响连通性的字段一改，上次测试结论即过期。
  const setEndpoint = (patch: Partial<Connection>) => setConnection({ ...patch, lastTest: undefined });

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await agentRuntimeApi.testConnection(toProbeInput(connection));
      setConnection({
        lastTest: { ok: result.ok, at: new Date().toISOString(), reason: result.reason },
      });
    } catch (error) {
      setConnection({
        lastTest: { ok: false, at: new Date().toISOString(), reason: errorText(error) },
      });
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setFetching(true);
    setFetchStatus(null);
    try {
      const result = await agentRuntimeApi.listModels(toProbeInput(connection));
      // 已选中的模型若在新列表里，顺带把上游自报的窗口/输出上限刷新进来。
      const selected = result.models.find((model) => model.id === connection.model);
      setConnection({
        models: result.models,
        ...(selected ? metaForModel(selected, connection) : {}),
      });
      setFetchStatus({
        tone: result.models.length ? "good" : "warn",
        text: result.models.length
          ? t("cfg_n_models", { n: result.models.length })
          : result.reason || t("cfg_no_models"),
      });
    } catch (error) {
      setFetchStatus({ tone: "crit", text: errorText(error) });
    } finally {
      setFetching(false);
    }
  };

  const picked = models.find((m) => m.id === connection.model);
  const metaSource = picked?.context_window ? t("cfg_meta_upstream") : t("cfg_meta_prefilled");
  const maxInvalid =
    connection.contextWindow !== null &&
    connection.maxTokens !== null &&
    connection.maxTokens >= connection.contextWindow;

  return (
    <div
      className={variant === "panel" ? "cfgpanel" : "cfgpop"}
      role={variant === "panel" ? undefined : "dialog"}
      aria-label={t("cfg_title")}
    >
      {variant === "popover" && <div className="cfghead">{t("cfg_title")}</div>}

      <StatusCard connection={connection} testing={testing} onTest={() => void testConnection()} t={t} />

      <section className="cfg-group">
        <h3 className="cfg-group-title">{t("cfg_group_service")}</h3>
        <Field label={t("cfg_provider")}>
          <Segmented<VlmProvider>
            label={t("cfg_provider")}
            value={connection.provider}
            onChange={(provider) => setEndpoint({ provider, models: undefined, mediaAdapter: "none" })}
            options={[
              { value: "anthropic", label: "Anthropic" },
              { value: "openai_compatible", label: t("cfg_openai_compat") },
            ]}
          />
        </Field>
        {oai && (
          <Field
            label={t("cfg_base_url")}
            htmlFor={id("url")}
            hint={
              <>
                <span>{t("cfg_quickfill")}</span>
                {LOCAL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="cfgqbtn"
                    type="button"
                    onClick={() => setEndpoint({ baseUrl: preset.baseUrl })}
                  >
                    {preset.label}
                  </button>
                ))}
              </>
            }
          >
            <input
              id={id("url")}
              className="cfgin"
              type="url"
              placeholder={t("cfg_base_url_ph")}
              value={connection.baseUrl}
              onChange={(event) => setEndpoint({ baseUrl: event.target.value })}
            />
          </Field>
        )}
        <Field
          label={t("cfg_key")}
          htmlFor={id("key")}
          hint={
            <>
              <span>{t("vlm_key_persist_note")}</span>
              {connection.apiKey && (
                <button className="cfglink" type="button" onClick={() => setEndpoint({ apiKey: "" })}>
                  {t("vlm_key_clear")}
                </button>
              )}
            </>
          }
        >
          <div className="cfg-inwrap">
            <input
              id={id("key")}
              className="cfgin"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder={t("cfg_key_ph")}
              value={connection.apiKey}
              onChange={(event) => setEndpoint({ apiKey: event.target.value })}
            />
            <button
              className="cfg-inbtn"
              type="button"
              aria-label={t(showKey ? "cfg_key_hide" : "cfg_key_show")}
              title={t(showKey ? "cfg_key_hide" : "cfg_key_show")}
              onClick={() => setShowKey((v) => !v)}
            >
              <Icon icon={showKey ? ICONS.eyeOff : ICONS.eye} size="sm" />
            </button>
          </div>
        </Field>
      </section>

      <section className="cfg-group">
        <h3 className="cfg-group-title">{t("cfg_group_model")}</h3>
        <Field
          label={t("cfg_model")}
          htmlFor={id("model")}
          hint={
            <>
              <span>
                {oai
                  ? `${t("cfg_model_meta", { ctx: compact(connection.contextWindow), out: compact(connection.maxTokens) })}（${metaSource}）`
                  : t("cfg_meta_anthropic")}
              </span>
              {fetchStatus && <span className={`cfg-tone ${fetchStatus.tone}`}>{fetchStatus.text}</span>}
            </>
          }
        >
          <div className="cfg-inline">
            <input
              id={id("model")}
              className="cfgin"
              type="text"
              list={models.length ? MODEL_LIST_ID : undefined}
              placeholder={oai ? t("cfg_model_ph") : "claude-haiku-4-5-20251001"}
              value={connection.model}
              onChange={(event) => {
                const model = event.target.value;
                const match = models.find((candidate) => candidate.id === model);
                setEndpoint({ model, ...(match ? metaForModel(match, connection) : {}) });
              }}
            />
            <button className="cfgbtn cfg-inline-btn" type="button" disabled={fetching} onClick={() => void fetchModels()}>
              <Icon icon={fetching ? ICONS.spinner : ICONS.regenerate} size="sm" className={fetching ? "spin" : undefined} />
              {t("cfg_fetch_models")}
            </button>
          </div>
          {models.length > 0 && (
            <datalist id={MODEL_LIST_ID}>
              {models.map((model) => (
                <option key={model.id} value={model.id} />
              ))}
            </datalist>
          )}
        </Field>
      </section>

      {oai && (
        <section className="cfg-group">
          <h3 className="cfg-group-title">{t("cfg_group_capability")}</h3>
          <Field label={t("cfg_media_adapter")} hint={t("cfg_media_desc")}>
            <Segmented<MediaAdapter>
              label={t("cfg_media_adapter")}
              value={connection.mediaAdapter ?? "none"}
              onChange={(mediaAdapter) => setConnection({ mediaAdapter })}
              options={[
                { value: "none", label: t("cfg_media_none") },
                { value: "qwen-omni", label: t("cfg_media_qwen") },
              ]}
            />
          </Field>
        </section>
      )}

      {oai && (
        <details className="cfg-group cfg-advanced" open={maxInvalid || undefined}>
          <summary className="cfg-group-title">
            <span>{t("cfg_group_advanced")}</span>
            <span className="cfg-adv-summary">
              {t("cfg_adv_summary", {
                ctx: connection.contextWindow?.toLocaleString() ?? "—",
                out: connection.maxTokens?.toLocaleString() ?? "—",
              })}
            </span>
            <Icon icon={ICONS.chevronDown} size="sm" className="cfg-adv-chevron" />
          </summary>
          <Field label={t("cfg_context_window")} htmlFor={id("ctx")}>
            <input
              id={id("ctx")}
              className="cfgin cfgnum"
              type="number"
              min={1024}
              value={connection.contextWindow ?? ""}
              onChange={(event) => setConnection({ contextWindow: optionalInteger(event.target.value) })}
            />
          </Field>
          <Field
            label={t("cfg_max_tokens")}
            htmlFor={id("max")}
            hint={
              <span className={maxInvalid ? "cfg-tone crit" : undefined}>
                {t(maxInvalid ? "cfg_max_invalid" : "cfg_model_meta_note")}
              </span>
            }
          >
            <input
              id={id("max")}
              className="cfgin cfgnum"
              type="number"
              min={1}
              aria-invalid={maxInvalid || undefined}
              value={connection.maxTokens ?? ""}
              onChange={(event) => setConnection({ maxTokens: optionalInteger(event.target.value) })}
            />
          </Field>
        </details>
      )}

      {variant === "popover" && (
        <button className="cfgclose" type="button" aria-label="Close" onClick={onClose}>
          <Icon icon={ICONS.close} size="sm" />
        </button>
      )}
    </div>
  );
}
