import { useEffect, useRef, useState } from "react";

import { useAgent } from "../agent/useAgent";
import { Rich } from "./Rich";
import { ApiError, api } from "../api/client";
import type { Measure, TaskType, VlmModelInfo, VlmProvider } from "../api/types";
import { useI18n } from "../i18n";
import { useSession, type IntentBackendId, type Msg, type Tool } from "../store/session";

// 本地部署快填（Ollama / LM Studio 默认端点）——SDD 2026-07-14-001 §3。
const LOCAL_PRESETS = [
  { key: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { key: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
] as const;

/** 视觉能力 → 下拉前缀标记（👁 可用 / · 待定 / ⊘ 无）。 */
function visMark(v: VlmModelInfo["vision"]): string {
  return v === "yes" ? "👁" : v === "no" ? "⊘" : "·";
}

function IntentConfig({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const backend = useSession((s) => s.intentBackend);
  const setBackend = useSession((s) => s.setIntentBackend);
  const backends = useSession((s) => s.intentBackends);
  const conn = useSession((s) => s.connection);
  const setConnection = useSession((s) => s.setConnection);
  const serverKey = backends.find((b) => b.id === "vlm")?.available ?? false;

  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<{ tone: "good" | "warn" | "crit"; text: string } | null>(null);

  const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

  const runTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const r = await api.vlmTest(conn.provider, conn.baseUrl || undefined, conn.apiKey || undefined);
      setConnection({ lastTest: { ok: r.ok, at: new Date().toISOString(), reason: r.reason } });
      if (r.ok) {
        const bits = [String(r.status ?? ""), t("cfg_n_models", { n: r.model_count ?? "?" })];
        if (r.vision_count != null) bits.push(t("cfg_n_vision", { n: r.vision_count }));
        setStatus({ tone: "good", text: `${t("cfg_connected")} · ${bits.filter(Boolean).join(" · ")}` });
      } else {
        setStatus({ tone: "crit", text: r.reason });
      }
    } catch (e) {
      setStatus({ tone: "crit", text: errText(e) });
    } finally {
      setTesting(false);
    }
  };

  const runFetch = async () => {
    setFetching(true);
    setStatus(null);
    try {
      const r = await api.vlmModels(conn.provider, conn.baseUrl || undefined, conn.apiKey || undefined);
      if (r.models.length) {
        setConnection({ models: r.models });
        const vis = r.models.filter((m) => m.vision === "yes").length;
        setStatus({
          tone: "good",
          text: `${t("cfg_n_models", { n: r.models.length })} · ${t("cfg_n_vision", { n: vis })}`,
        });
      } else {
        setStatus({ tone: "warn", text: r.reason || t("cfg_no_models") });
      }
    } catch (e) {
      setStatus({ tone: "crit", text: errText(e) });
    } finally {
      setFetching(false);
    }
  };

  const opt = (id: IntentBackendId, label: string, desc: string) => (
    <label className={"cfgopt" + (backend === id ? " on" : "")}>
      <input type="radio" name="ib" checked={backend === id} onChange={() => setBackend(id)} />
      <div>
        <div className="cfgnm">{label}</div>
        <div className="cfgdesc">{desc}</div>
      </div>
    </label>
  );

  const models = conn.models ?? [];
  const modelInList = models.some((m) => m.id === conn.model);

  return (
    <div className="cfgpop" onClick={(e) => e.stopPropagation()}>
      <div className="cfghead">{t("cfg_title")}</div>
      {opt("rule", t("cfg_rule"), t("cfg_rule_desc"))}
      {opt("vlm", t("cfg_vlm"), t("cfg_vlm_desc"))}
      {backend === "vlm" && (
        <div className="cfgvlm">
          {/* provider */}
          <label className="cfgrow">
            <span>{t("cfg_provider")}</span>
            <select
              className="cfgsel"
              value={conn.provider}
              onChange={(e) =>
                setConnection({ provider: e.target.value as VlmProvider, models: undefined })
              }
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai_compatible">{t("cfg_openai_compat")}</option>
            </select>
          </label>

          {/* 本地部署快填（仅 openai_compatible） */}
          {conn.provider === "openai_compatible" && (
            <div className="cfgquick">
              <span className="cfgqlbl">{t("cfg_quickfill")}</span>
              {LOCAL_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className="cfgqbtn"
                  onClick={() => setConnection({ baseUrl: p.baseUrl })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* base_url（openai_compatible 必填；anthropic 可选覆盖） */}
          {(conn.provider === "openai_compatible" || conn.baseUrl) && (
            <input
              className="cfgin"
              type="text"
              placeholder={t("cfg_base_url_ph")}
              value={conn.baseUrl}
              onChange={(e) => setConnection({ baseUrl: e.target.value })}
            />
          )}

          {/* anthropic：显示服务端 env 密钥可用性 */}
          {conn.provider === "anthropic" && (
            <div className="cfgrow">
              <span>{t("cfg_server_key")}</span>
              <span
                style={{
                  color: serverKey ? "var(--good)" : "var(--faint)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: serverKey ? "1px solid rgba(78,201,138,.4)" : "none",
                  background: serverKey ? "rgba(78,201,138,.14)" : "transparent",
                }}
              >
                {serverKey ? t("cfg_available") : t("cfg_unavailable")}
              </span>
            </div>
          )}

          <input
            className="cfgin"
            type="password"
            placeholder={t("cfg_key_ph")}
            value={conn.apiKey}
            onChange={(e) => setConnection({ apiKey: e.target.value })}
          />

          {/* 模型：拉取后变下拉（👁 标注）；否则手输 */}
          {models.length > 0 ? (
            <select
              className="cfgsel"
              value={conn.model}
              onChange={(e) => setConnection({ model: e.target.value })}
            >
              <option value="" disabled>
                {t("cfg_model_pick")}
              </option>
              {!modelInList && conn.model && <option value={conn.model}>{conn.model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {visMark(m.vision)} {m.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="cfgin"
              type="text"
              placeholder={
                conn.provider === "anthropic" ? "claude-haiku-4-5-20251001" : t("cfg_model_ph")
              }
              value={conn.model}
              onChange={(e) => setConnection({ model: e.target.value })}
            />
          )}

          {/* 动作 */}
          <div className="cfgacts">
            <button className="cfgbtn" onClick={runTest} disabled={testing}>
              {testing ? "…" : t("cfg_test")}
            </button>
            <button className="cfgbtn" onClick={runFetch} disabled={fetching}>
              {fetching ? "…" : t("cfg_fetch_models")}
            </button>
          </div>
          {status && <div className={"cfgstat " + status.tone}>{status.text}</div>}
          {models.length > 0 && <div className="cfgnote">{t("cfg_vis_legend")}</div>}

          <div className="cfgnote" style={{ marginTop: 2, lineHeight: 1.45 }}>
            {t("vlm_key_persist_note")}
            {conn.apiKey && (
              <>
                {" "}
                <button
                  className="cfglink"
                  type="button"
                  onClick={() => setConnection({ apiKey: "" })}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--agent)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "inherit",
                  }}
                >
                  {t("vlm_key_clear")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <button className="cfgclose" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

// 泛型任务运行卡片——按注册表（label/metrics/overlays）渲染任意模态的运行结果。
// 头条=首个度量；其余度量（含金标准偏差 vs_*）平铺；可编辑叠加才出「修正」按钮。加任务零改。
function AgentTaskRun({ task, model, metrics }: { task: TaskType; model: string; metrics: Record<string, Measure> }) {
  const { t, lang } = useI18n();
  const tasks = useSession((s) => s.tasks);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);
  const setPanelTab = useSession((s) => s.setPanelTab);

  const tv = tasks.find((x) => x.task === task);
  const label = tv?.label[lang] ?? task;
  const defs = tv?.metrics ?? [];
  const editRole = tv?.overlays.find((o) => o.editable)?.role;

  // 度量按注册表顺序在前，后端追加的金标准偏差（vs_*）在后
  const keys = [...defs.map((d) => d.key), ...Object.keys(metrics).filter((k) => !defs.some((d) => d.key === k))];
  const ordered = keys.map((k) => [k, metrics[k]] as const).filter(([, mm]) => !!mm);
  const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1));
  const head = ordered[0]?.[1];
  const rest = ordered.slice(1);

  return (
    <div className="abody">
      {t("task_intro", { task: label })}
      <ul className="steps">
        <li><span className="st">✓</span><Rich k="st_interpret" vars={{ task }} /></li>
        <li><span className="st">✓</span><Rich k="st_calibrate" vars={{ cf: String(cf ?? "—") }} /></li>
        <li><span className="st">✓</span><Rich k="st_detect" vars={{ model }} /></li>
        <li><span className="st">✓</span><Rich k="st_measure" /></li>
      </ul>
      {head && (
        <div className="prop">
          <div className="r">
            <div className="val">
              {fmt(head.value)}
              <u>{head.unit}</u>
            </div>
            <span className="conf">{t("conf")}</span>
          </div>
          {rest.length > 0 && (
            <div className="r" style={{ marginTop: 5, fontSize: 11, color: "var(--faint)", flexWrap: "wrap", gap: 8 }}>
              {rest.map(([k, mm]) => (
                <span key={k} className="mono">
                  {(lang === "zh" ? mm.label_zh : mm.label_en)} {fmt(mm.value)} {mm.unit}
                </span>
              ))}
            </div>
          )}
          <div className="act">
            <button
              className="accept"
              onClick={() => {
                pushAgent({ variant: "plain", key: "accepted" });
                setPanelTab("meas");
              }}
            >
              {t("accept")}
            </button>
            {editRole && (
              <button
                className="correct"
                onClick={() => {
                  setTool(`edit${editRole.toLowerCase()}` as Tool);
                  pushAgent({ variant: "plain", key: "switch_edit" });
                }}
              >
                {t("correct")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTurn({ m }: { m: Extract<Msg, { role: "agent" }> }) {
  const { t } = useI18n();
  return (
    <div className="turn agent">
      <div className="who">
        <span className="d" />
        {t("agent_name")}
      </div>
      {m.variant === "taskrun" ? (
        <AgentTaskRun task={m.task} model={m.model} metrics={m.metrics} />
      ) : m.variant === "note" ? (
        <div className={"abody " + (m.tone === "crit" ? "refuse" : "plain")}>{m.text}</div>
      ) : (
        <Rich as="div" className={"abody " + m.variant} k={m.key} vars={m.vars} />
      )}
    </div>
  );
}

export function AgentPanel() {
  const { t } = useI18n();
  const messages = useSession((s) => s.messages);
  const model = useSession((s) => s.activeModel);
  const backend = useSession((s) => s.intentBackend);
  const conn = useSession((s) => s.connection);
  const modality = useSession((s) => s.modality);
  const { run } = useAgent();
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cfgOpen, setCfgOpen] = useState(false);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const v = inputRef.current?.value ?? "";
    if (!v.trim()) return;
    void run(v);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <aside className="agent">
      <div className="ahead" style={{ position: "relative" }}>
        <div className="aicon">✦</div>
        <div>
          <b>{t("agent_name")}</b>
        </div>
        <button
          className="amodel"
          onClick={() => setCfgOpen((o) => !o)}
          title={t("cfg_title")}
          style={{ cursor: "pointer", marginLeft: "auto" }}
        >
          {backend === "vlm"
            ? `✦ VLM${conn.model ? " · " + conn.model.split(/[/:]/).pop()!.slice(0, 14) : ""}`
            : "⚙ rule"}
        </button>
        <span className="amodel">{model}</span>
        {cfgOpen && <IntentConfig onClose={() => setCfgOpen(false)} />}
      </div>
      <div className="stream" ref={streamRef}>
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="turn user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <AgentTurn key={m.id} m={m} />
          ),
        )}
      </div>
      <div className="composer">
        <div className="cfield">
          <span className="g">✦</span>
          <input
            ref={inputRef}
            placeholder={t("ph")}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button className="send" onClick={submit}>
            ↑
          </button>
        </div>
        <div className="chips">
          {(modality === "fetal_hc"
            ? (["chip_hc1", "chip2", "chip3"] as const)
            : (["chip1", "chip2", "chip3"] as const)
          ).map((c) => (
            <button key={c} onClick={() => run(t(c))}>
              {t(c)}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
