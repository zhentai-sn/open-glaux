import { useState } from "react";

import { AgentRuntimeError, agentRuntimeApi } from "../../agent/runtime/client";
import { toProbeInput } from "../../agent/useConversation";
import type { VlmModelInfo, VlmProvider } from "../../api/types";
import { useI18n } from "../../i18n";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  type Connection,
  useSession,
} from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

const LOCAL_PRESETS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
] as const;
const MODEL_LIST_ID = "glaux-model-options";

function optionalInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

/**
 * 模型与连接表单。popover：Workbench 对话面板的浮层（带标题与关闭钮）；
 * panel：嵌进 Focus 设置面板的「模型与连接」分区（SDD feats/01 v1.7 D23），标题与关闭由面板负责。
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
  const [status, setStatus] = useState<{
    tone: "good" | "warn" | "crit";
    text: string;
  } | null>(null);

  const errorText = (error: unknown) =>
    error instanceof AgentRuntimeError ? error.message : String(error);

  const testConnection = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await agentRuntimeApi.testConnection(toProbeInput(connection));
      setConnection({
        lastTest: {
          ok: result.ok,
          at: new Date().toISOString(),
          reason: result.reason,
        },
      });
      setStatus({
        tone: result.ok ? "good" : "crit",
        text: result.ok
          ? `${t("cfg_connected")} · ${t("cfg_n_models", { n: result.model_count ?? "?" })}`
          : result.reason,
      });
    } catch (error) {
      setStatus({ tone: "crit", text: errorText(error) });
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setFetching(true);
    setStatus(null);
    try {
      const result = await agentRuntimeApi.listModels(toProbeInput(connection));
      // 已选中的模型若在新列表里，顺带把上游自报的窗口/输出上限刷新进来。
      const selected = result.models.find((model) => model.id === connection.model);
      setConnection({
        models: result.models,
        ...(selected ? metaForModel(selected, connection) : {}),
      });
      setStatus({
        tone: result.models.length ? "good" : "warn",
        text: result.models.length
          ? t("cfg_n_models", { n: result.models.length })
          : result.reason || t("cfg_no_models"),
      });
    } catch (error) {
      setStatus({ tone: "crit", text: errorText(error) });
    } finally {
      setFetching(false);
    }
  };

  const models = connection.models ?? [];

  return (
    <div
      className={variant === "panel" ? "cfgpanel" : "cfgpop"}
      role={variant === "panel" ? undefined : "dialog"}
      aria-label={t("cfg_title")}
    >
      {variant === "popover" && <div className="cfghead">{t("cfg_title")}</div>}
      <label className="cfgrow">
        <span>{t("cfg_provider")}</span>
        <select
          className="cfgsel"
          value={connection.provider}
          onChange={(event) =>
            setConnection({
              provider: event.target.value as VlmProvider,
              models: undefined,
              mediaAdapter: "none",
            })
          }
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai_compatible">{t("cfg_openai_compat")}</option>
        </select>
      </label>

      {connection.provider === "openai_compatible" && (
        <>
          <label className="cfgrow">
            <span>{t("cfg_media_adapter")}</span>
            <select
              className="cfgsel"
              value={connection.mediaAdapter ?? "none"}
              onChange={(event) => setConnection({ mediaAdapter: event.target.value as "none" | "qwen-omni" })}
            >
              <option value="none">{t("cfg_media_none")}</option>
              <option value="qwen-omni">{t("cfg_media_qwen")}</option>
            </select>
          </label>
          <div className="cfgquick">
            <span className="cfgqlbl">{t("cfg_quickfill")}</span>
            {LOCAL_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="cfgqbtn"
                type="button"
                onClick={() => setConnection({ baseUrl: preset.baseUrl })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            className="cfgin"
            type="url"
            aria-label={t("cfg_base_url_ph")}
            placeholder={t("cfg_base_url_ph")}
            value={connection.baseUrl}
            onChange={(event) => setConnection({ baseUrl: event.target.value })}
          />
        </>
      )}

      <input
        className="cfgin"
        type="password"
        aria-label={t("cfg_key")}
        placeholder={t("cfg_key_ph")}
        value={connection.apiKey}
        onChange={(event) => setConnection({ apiKey: event.target.value })}
      />

      <input
        className="cfgin"
        type="text"
        list={models.length ? MODEL_LIST_ID : undefined}
        aria-label={t("cfg_model")}
        placeholder={
          connection.provider === "anthropic"
            ? "claude-haiku-4-5-20251001"
            : t("cfg_model_ph")
        }
        value={connection.model}
        onChange={(event) => {
          const model = event.target.value;
          const picked = models.find((candidate) => candidate.id === model);
          setConnection({
            model,
            ...(picked ? metaForModel(picked, connection) : {}),
          });
        }}
      />
      {models.length > 0 && (
        <datalist id={MODEL_LIST_ID}>
          {models.map((model) => (
            <option key={model.id} value={model.id} />
          ))}
        </datalist>
      )}

      {connection.provider === "openai_compatible" && (
        <>
          <label className="cfgrow">
            <span>{t("cfg_context_window")}</span>
            <input
              className="cfgin cfgnum"
              type="number"
              min={1024}
              value={connection.contextWindow ?? ""}
              onChange={(event) =>
                setConnection({ contextWindow: optionalInteger(event.target.value) })
              }
            />
          </label>
          <label className="cfgrow">
            <span>{t("cfg_max_tokens")}</span>
            <input
              className="cfgin cfgnum"
              type="number"
              min={1}
              value={connection.maxTokens ?? ""}
              onChange={(event) =>
                setConnection({ maxTokens: optionalInteger(event.target.value) })
              }
            />
          </label>
          <div className="cfgnote">{t("cfg_model_meta_note")}</div>
        </>
      )}

      <div className="cfgacts">
        <button
          className="cfgbtn"
          type="button"
          disabled={testing}
          onClick={() => void testConnection()}
        >
          {testing ? "…" : t("cfg_test")}
        </button>
        <button
          className="cfgbtn"
          type="button"
          disabled={fetching}
          onClick={() => void fetchModels()}
        >
          {fetching ? "…" : t("cfg_fetch_models")}
        </button>
      </div>
      {status && <div className={`cfgstat ${status.tone}`}>{status.text}</div>}
      <div className="cfgnote">
        {t("vlm_key_persist_note")}{" "}
        {connection.apiKey && (
          <button
            className="cfglink"
            type="button"
            onClick={() => setConnection({ apiKey: "" })}
          >
            {t("vlm_key_clear")}
          </button>
        )}
      </div>
      {variant === "popover" && (
        <button
          className="cfgclose"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon icon={ICONS.close} size="sm" />
        </button>
      )}
    </div>
  );
}
