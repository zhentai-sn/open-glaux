import { useEffect, useRef } from "react";

import { useAgent } from "../agent/useAgent";
import { Rich } from "./Rich";
import { useI18n } from "../i18n";
import { useSession, type Msg } from "../store/session";

function AgentRun({ model, imt }: { model: string; imt: string }) {
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
          <span>{t("psub")}</span>
          <span className="mono">{t("pmax")}</span>
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

function AgentTurn({ m }: { m: Extract<Msg, { role: "agent" }> }) {
  const { t } = useI18n();
  return (
    <div className="turn agent">
      <div className="who">
        <span className="d" />
        {t("agent_name")}
      </div>
      {m.variant === "run" ? (
        <AgentRun model={m.model} imt={m.imt} />
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
  const { run } = useAgent();
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="ahead">
        <div className="aicon">✦</div>
        <div>
          <b>{t("agent_name")}</b>
        </div>
        <span className="amodel">{model}</span>
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
          {(["chip1", "chip2", "chip3"] as const).map((c) => (
            <button key={c} onClick={() => run(t(c))}>
              {t(c)}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
