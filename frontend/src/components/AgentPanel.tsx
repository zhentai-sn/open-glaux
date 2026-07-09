import { useEffect, useRef, useState } from "react";

import { useAgent } from "../agent/useAgent";
import { Rich } from "./Rich";
import type { Measure, TaskType } from "../api/types";
import { useI18n } from "../i18n";
import { useSession, type IntentBackendId, type Msg, type Tool } from "../store/session";

function IntentConfig({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const backend = useSession((s) => s.intentBackend);
  const setBackend = useSession((s) => s.setIntentBackend);
  const backends = useSession((s) => s.intentBackends);
  const vlmKey = useSession((s) => s.vlmKey);
  const setVlmKey = useSession((s) => s.setVlmKey);
  const vlmModel = useSession((s) => s.vlmModel);
  const setVlmModel = useSession((s) => s.setVlmModel);
  const serverKey = backends.find((b) => b.id === "vlm")?.available ?? false;

  const opt = (id: IntentBackendId, label: string, desc: string) => (
    <label className={"cfgopt" + (backend === id ? " on" : "")}>
      <input type="radio" name="ib" checked={backend === id} onChange={() => setBackend(id)} />
      <div>
        <div className="cfgnm">{label}</div>
        <div className="cfgdesc">{desc}</div>
      </div>
    </label>
  );

  return (
    <div className="cfgpop" onClick={(e) => e.stopPropagation()}>
      <div className="cfghead">{t("cfg_title")}</div>
      {opt("rule", t("cfg_rule"), t("cfg_rule_desc"))}
      {opt("vlm", t("cfg_vlm"), t("cfg_vlm_desc"))}
      {backend === "vlm" && (
        <div className="cfgvlm">
          <div className="cfgrow">
            <span>{t("cfg_server_key")}</span>
            <span className={serverKey ? "wip" : ""} style={{ color: serverKey ? "var(--good)" : "var(--faint)", borderColor: serverKey ? "rgba(78,201,138,.4)" : undefined, background: serverKey ? "rgba(78,201,138,.14)" : "transparent" }}>
              {serverKey ? t("cfg_available") : t("cfg_unavailable")}
            </span>
          </div>
          <input className="cfgin" type="password" placeholder={t("cfg_key_ph")} value={vlmKey} onChange={(e) => setVlmKey(e.target.value)} />
          <input className="cfgin" type="text" placeholder={"claude-haiku-4-5-20251001"} value={vlmModel} onChange={(e) => setVlmModel(e.target.value)} />
          <div className="cfgnote">{t("cfg_model")}</div>
          <div className="cfgnote" style={{ marginTop: 6, lineHeight: 1.45 }}>
            {t("vlm_key_persist_note")}
            {vlmKey && (
              <>
                {" "}
                <button
                  className="cfglink"
                  type="button"
                  onClick={() => setVlmKey("")}
                  style={{ background: "transparent", border: "none", color: "var(--agent)", cursor: "pointer", padding: 0, fontSize: "inherit" }}
                >
                  {t("vlm_key_clear")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <button className="cfgclose" onClick={onClose}>✕</button>
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
          {backend === "vlm" ? "✦ VLM" : "⚙ rule"}
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
