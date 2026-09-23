import { useEffect, useRef, useState } from "react";

import { useConversation } from "../agent/useConversation";
import { useSession } from "../store/session";

// 底部 CLI 终端（设计稿 §6）——轻量自绘命令行「起壳」：输出区 + 输入行，内置几条命令读注册表 /
// 派智能体。真正的 CLI 工具（PTY over WebSocket / xterm）后期接入；未接命令诚实回「not wired」。
// 注：曾试 xterm.js，其 DOM 渲染器在本预览环境不上屏（buffer 有内容但不绘），故 v0 用自绘保稳。
type Kind = "in" | "out" | "err" | "dim";
type Line = { id: number; text: string; kind: Kind };

const PROMPT = "glaux$";
const COLOR: Record<Kind, string> = { in: "var(--agent)", out: "#c9d1d9", err: "#ff8a8a", dim: "var(--faint)" };
let _lid = 0;

export function TerminalView() {
  const [lines, setLines] = useState<Line[]>([
    { id: _lid++, text: "Glaux CLI · stub shell — 输入 help 查看命令（真 CLI 工具后期接入）", kind: "dim" },
  ]);
  const [input, setInput] = useState("");
  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);
  // `run <nl>` 投递到当前智能体会话（与 Focus / Agent 面板同一条对话路径；退役 orchestration P3）
  const { send } = useConversation();

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [lines]);
  useEffect(() => {
    inRef.current?.focus();
  }, []);

  const emit = (arr: { text: string; kind: Kind }[]) => setLines((ls) => [...ls, ...arr.map((l) => ({ ...l, id: _lid++ }))]);

  const exec = (raw: string) => {
    emit([{ text: `${PROMPT} ${raw}`, kind: "in" }]);
    const line = raw.trim();
    const sp = line.indexOf(" ");
    const cmd = sp < 0 ? line : line.slice(0, sp);
    const arg = sp < 0 ? "" : line.slice(sp + 1).trim();
    const st = useSession.getState();
    switch (cmd) {
      case "":
        break;
      case "help":
        emit([{ text: "commands: help · clear · tasks · caps · models · run <nl> · echo <text>", kind: "out" }]);
        break;
      case "clear":
        setLines([]);
        break;
      case "tasks":
        emit(st.tasks.map((tk) => ({ text: `  ${tk.task}  (${tk.modality} · ${tk.object_kinds.join("|")} · ${tk.trigger})`, kind: "out" })));
        break;
      case "caps":
        emit(st.capabilities.map((c) => ({ text: `  [${c.layer}] ${c.kind}  ${c.id}  ${c.status}`, kind: "out" })));
        break;
      case "models":
        emit(st.models.map((m) => ({ text: `  ${m.active ? "*" : " "} ${m.id}  ${m.pub}`, kind: "out" })));
        break;
      case "run":
        if (!arg) {
          emit([{ text: "usage: run <natural language>", kind: "err" }]);
          break;
        }
        emit([{ text: `→ dispatching to agent: ${arg}`, kind: "dim" }]);
        void send(arg).catch((e: unknown) =>
          emit([{ text: `agent: ${e instanceof Error ? e.message : String(e)}`, kind: "err" }]),
        );
        break;
      case "echo":
        emit([{ text: arg, kind: "out" }]);
        break;
      default:
        emit([{ text: `${cmd}: not wired yet (stub shell)`, kind: "err" }]);
    }
  };

  return (
    <div
      className="cli"
      onClick={() => inRef.current?.focus()}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: "#c9d1d9",
      }}
    >
      <div ref={outRef} style={{ flex: 1, overflowY: "auto", padding: "6px 10px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {lines.map((l) => (
          <div key={l.id} style={{ color: COLOR[l.kind] }}>
            {l.text || " "}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderTop: "1px solid var(--line)" }}>
        <span style={{ color: "#4FB0FF" }}>{PROMPT}</span>
        <input
          ref={inRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              exec(input);
              setInput("");
            }
          }}
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#c9d1d9", fontFamily: "inherit", fontSize: "inherit" }}
        />
      </div>
    </div>
  );
}
