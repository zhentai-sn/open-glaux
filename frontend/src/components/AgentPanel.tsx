import { useEffect, useRef, useState } from "react";

import { useAgent } from "../agent/useAgent";
import { Rich } from "./Rich";
import { useI18n } from "../i18n";
import { useSession, type IntentBackendId, type Msg } from "../store/session";

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
        </div>
      )}
      <button className="cfgclose" onClick={onClose}>✕</button>
    </div>
  );
}

function AgentRun({ model, imt, max, cols, vsA1 }: { model: string; imt: string; max: string; cols: number; vsA1: number | null }) {
  const { t } = useI18n();
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);
  const setPanelTab = useSession((s) => s.setPanelTab);

  return (
    <div className="abody">
      {t("intro")}
      <ul className="steps">
        <li><span className="st">✓</span><Rich k="s_interp" /></li>
        <li><span className="st">✓</span><Rich k="s_cal" /></li>
        <li><span className="st">✓</span><Rich k="s_seg" vars={{ model }} /></li>
        <li><span className="st">✓</span><Rich k="s_meas" /></li>
      </ul>
      <div className="prop">
        <div className="r">
          <div className="val">
            {imt}
            <u>mm</u>
          </div>
          <span className="conf">{t("conf")}</span>
        </div>
        <div className="r" style={{ marginTop: 5, fontSize: 11, color: "var(--faint)" }}>
          <span>{t("m_vsa1")} {vsA1 == null ? "—" : `${vsA1.toFixed(1)} µm`}</span>
          <span className="mono">max {max} · cols {cols}</span>
        </div>
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
          <button
            className="correct"
            onClick={() => {
              setTool("editma");
              pushAgent({ variant: "plain", key: "switch_ma" });
            }}
          >
            {t("correct")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentHCRun({ model, hc, bpd, ofd, vsGt }: { model: string; hc: string; bpd: string; ofd: string; vsGt: number | null }) {
  const { t } = useI18n();
  const pushAgent = useSession((s) => s.pushAgent);
  const setPanelTab = useSession((s) => s.setPanelTab);

  return (
    <div className="abody">
      {t("intro_hc")}
      <ul className="steps">
        <li><span className="st">✓</span><Rich k="hs_interp" /></li>
        <li><span className="st">✓</span><Rich k="hs_cal" /></li>
        <li><span className="st">✓</span><Rich k="hs_det" vars={{ model }} /></li>
        <li><span className="st">✓</span><Rich k="hs_meas" /></li>
      </ul>
      <div className="prop">
        <div className="r">
          <div className="val">
            {hc}
            <u>mm</u>
          </div>
          <span className="conf">{t("conf")}</span>
        </div>
        <div className="r" style={{ marginTop: 5, fontSize: 11, color: "var(--faint)" }}>
          <span>{t("m_vsgt")} {vsGt == null ? "—" : `${vsGt.toFixed(2)} mm`}</span>
          <span className="mono">BPD {bpd} · OFD {ofd}</span>
        </div>
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
        </div>
      </div>
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
      {m.variant === "run" ? (
        <AgentRun model={m.model} imt={m.imt} max={m.max} cols={m.cols} vsA1={m.vsA1} />
      ) : m.variant === "hcrun" ? (
        <AgentHCRun model={m.model} hc={m.hc} bpd={m.bpd} ofd={m.ofd} vsGt={m.vsGt} />
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
