import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import { THINKING_LEVELS, type ThinkingLevel } from "../../agent/runtime/types";
import type { ConnectionModelInfo } from "../../agent/runtime/types";
import { runtimeProviderName, toProbeInput } from "../../agent/useConversation";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { metaForModel } from "./ConnectionConfig";

/** 档位 → 词面键（输入区胶囊的后缀也用它）。 */
export const REASONING_LEVEL_KEY = {
  off: "agent_reasoning_off",
  low: "agent_reasoning_low",
  medium: "agent_reasoning_medium",
  high: "agent_reasoning_high",
} as const;

/** 行内的窗口 / 输出上限：`1M · 32K`，探不到的给 `—`。 */
function modelMeta(model: ConnectionModelInfo): string {
  const compact = (n: number | undefined) => {
    if (!n) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
    return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
  };
  return `${compact(model.context_window)} · ${compact(model.max_tokens)}`;
}

interface ModelMenuProps {
  sessionId: string | null;
  running: boolean;
  /** 「更多模型」：进连接设置（由对话列决定 Focus 还是浮层）。 */
  onMore: () => void;
}

/**
 * 模型与推理档位面板（SDD 00 §4、§5.2）：已连接后直接换模型，换档位即改连接偏好。
 * 模型列表取上次拉取的缓存；列表为空时提供一次拉取。换模型同步会话绑定（空闲时）。
 */
export function ModelMenu({ sessionId, running, onMore }: ModelMenuProps) {
  const { t } = useI18n();
  const connection = useSession((state) => state.connection);
  const setConnection = useSession((state) => state.setConnection);
  const setModel = useAgentSessions((state) => state.setModel);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const levelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const models = connection.models ?? [];
  const level: ThinkingLevel = connection.thinkingLevel ?? "off";
  const levelIndex = THINKING_LEVELS.indexOf(level);

  const pickModel = (model: ConnectionModelInfo) => {
    setConnection({ ...metaForModel(model, connection), model: model.id });
    // 会话绑定同步：列表与轨迹里的模型随之更新（SDD 21 §9.1 的 model_change）。
    if (sessionId && !running) void setModel(sessionId, runtimeProviderName(connection.provider), model.id);
  };

  const fetchModels = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const result = await agentRuntimeApi.listModels(toProbeInput(connection));
      if (result.models.length) setConnection({ models: result.models });
      else setFetchError(result.reason ?? t("agent_model_empty"));
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : t("agent_model_empty"));
    } finally {
      setFetching(false);
    }
  };

  const pickLevel = (next: ThinkingLevel) => {
    if (next !== level) setConnection({ thinkingLevel: next });
  };

  const onLevelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(THINKING_LEVELS.length - 1, levelIndex + step));
    levelRefs.current[next]?.focus();
    pickLevel(THINKING_LEVELS[next]!);
  };

  return (
    <div className="model-menu">
      <h4 className="composer-pop-title">{t("agent_model")}</h4>
      {models.length ? (
        <ul className="model-list" role="listbox" aria-label={t("agent_model")}>
          {models.map((model) => {
            const on = model.id === connection.model;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? "on" : undefined}
                  onClick={() => pickModel(model)}
                >
                  <span className="model-list-id">{model.id}</span>
                  {model.context_window || model.max_tokens ? (
                    <span className="model-list-meta" title={`${model.id} · ${modelMeta(model)}`}>
                      {modelMeta(model)}
                    </span>
                  ) : <span />}
                  {on && <Icon icon={ICONS.check} size="sm" className="model-list-check" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="model-empty">
          <button type="button" className="model-fetch" onClick={() => void fetchModels()} disabled={fetching}>
            {fetching ? t("agent_model_fetching") : t("agent_model_fetch")}
          </button>
          {fetchError && <small>{fetchError}</small>}
        </div>
      )}

      <div className="composer-pop-sep" />

      <div className="reason-head">
        <h4 className="composer-pop-title">{t("agent_reasoning")}</h4>
        <b>{t(REASONING_LEVEL_KEY[level])}</b>
      </div>
      <div className="reason-scale">
        <span>{t("agent_reasoning_faster")}</span>
        <span>{t("agent_reasoning_stronger")}</span>
      </div>
      <div
        className="reason-track"
        role="radiogroup"
        aria-label={t("agent_reasoning")}
        onKeyDown={onLevelKey}
        style={{ "--reason-ratio": levelIndex / (THINKING_LEVELS.length - 1) } as CSSProperties}
      >
        <span className="reason-rail" aria-hidden="true" />
        {THINKING_LEVELS.map((value, index) => (
          <button
            key={value}
            ref={(element) => { levelRefs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={value === level}
            aria-label={t(REASONING_LEVEL_KEY[value])}
            className={value === level ? "on" : undefined}
            onClick={() => pickLevel(value)}
          >
            <span className="reason-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="reason-hint">{t("agent_reasoning_hint")}</p>

      <div className="composer-pop-sep" />
      <button type="button" className="composer-pop-more" onClick={onMore}>
        {t("agent_model_more")}
        <Icon icon={ICONS.chevronRight} size="sm" />
      </button>
    </div>
  );
}
