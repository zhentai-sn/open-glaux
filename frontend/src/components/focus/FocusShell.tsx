import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useConversation } from "../../agent/useConversation";
import { useI18n, type I18nKey } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import {
  CONVERSATION_MIN_W,
  RAIL_W,
  SIDE_W,
  useSession,
} from "../../store/session";
import { AgentPanel } from "../AgentPanel";
import { ErrorBoundary } from "../ErrorBoundary";
import { Notice } from "../Notice";
import { OwlLogo } from "../OwlLogo";
import { FocusSidePanel } from "./FocusSidePanel";
import { FocusTopBar } from "./FocusTopBar";
import { PaneResizer } from "./PaneResizer";
import { SessionRail } from "./SessionRail";

// 空状态示例卡（纲领 G2：示例即教学；meta 行为任务/数据集标识，标识符不翻译）。
// 点击：连接可用即发送到参考智能体；未配模型则拉起 ⚙ 连接配置（不静默失败）。
const EXAMPLES: { title: I18nKey; desc: I18nKey; meta: I18nKey; prompt: I18nKey }[] = [
  { title: "focus_example_1_title", desc: "focus_example_1_desc", meta: "focus_example_1_meta", prompt: "focus_example_1_prompt" },
  { title: "focus_example_2_title", desc: "focus_example_2_desc", meta: "focus_example_2_meta", prompt: "focus_example_2_prompt" },
  { title: "focus_example_3_title", desc: "focus_example_3_desc", meta: "focus_example_3_meta", prompt: "focus_example_3_prompt" },
];

// 空状态布局按设计稿（mockup 视图 ①）：hero → 输入框卡片 → 示例卡，三段整组垂直居中。
function FocusHero() {
  const { t } = useI18n();
  return (
    <div className="focus-hero">
      <span className="focus-hero-logo" aria-hidden="true">
        <OwlLogo size={40} />
      </span>
      <h2>{t("focus_hero_title")}</h2>
      <p>{t("focus_hero_sub")}</p>
    </div>
  );
}

function FocusExampleCards({ onOpenConfig }: { onOpenConfig: () => void }) {
  const { t } = useI18n();
  const { send } = useConversation();
  const connection = useSession((s) => s.connection);
  const connected = useAgentSessions((s) => s.connected);
  const canSend = connected && Boolean(connection.model.trim());

  return (
    <div className="focus-cards">
      {EXAMPLES.map((ex) => (
        <button
          key={ex.title}
          className="focus-card"
          type="button"
          onClick={() => {
            if (canSend) void send(t(ex.prompt));
            else onOpenConfig();
          }}
        >
          <b>{t(ex.title)}</b>
          <span>{t(ex.desc)}</span>
          <span className="m">{t(ex.meta)}</span>
        </button>
      ))}
    </div>
  );
}

// Focus 外壳（SDD feats/01 §6.2/§8，v1.1）——纯布局壳：顶栏 + 会话栏 + 对话列 + 右侧栏（舞台/文件/图谱）。
// 领域状态全在共享 store，本组件零领域逻辑；对话列整体复用 AgentPanel（即 AgentConversation）。
export function FocusShell() {
  const { t } = useI18n();
  const [configOpen, setConfigOpen] = useState(false);
  const view = useAgentSessions((s) =>
    s.currentSessionId ? s.views[s.currentSessionId] : undefined,
  );
  const emptyConversation = !view || (view.messages?.length ?? 0) === 0;

  // ---- 栏宽可拖拽（SDD feats/01 v1.3 §7-7 / D15）----
  // 宽度真相在 store（持久化）；本壳只做「范围换算」：把静态上下界与当前实测宽度合成为
  // 「拖到这儿对话列还剩 ≥360px」的动态上界，交给分隔条夹住。
  const { railOpen, rightOpen, railW, sideW } = useSession((s) => s.focusLayout);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 右侧栏未拖过时按 flex 比例自适应，没有像素真相值——实测一份，供 aria 读数与拖拽起点用。
  const [measured, setMeasured] = useState({ body: 0, side: 0 });

  useLayoutEffect(() => {
    const read = () => {
      const body = bodyRef.current;
      if (!body) return;
      const side = body.querySelector<HTMLElement>(".focus-side");
      setMeasured({ body: body.clientWidth, side: side?.getBoundingClientRect().width ?? 0 });
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [rightOpen, railOpen, sideW, railW]);

  const railCur = railW ?? RAIL_W.def;
  const sideCur = sideW ?? Math.max(SIDE_W.min, measured.side);
  // 动态上界：容器宽 − 对侧栏当前宽 − 对话列最低宽；容器还没测到（首帧）时退回静态上界。
  const room = (otherW: number, staticMax: number) =>
    measured.body > 0
      ? Math.max(SIDE_W.min, Math.min(staticMax, measured.body - otherW - CONVERSATION_MIN_W))
      : staticMax;

  return (
    <div
      className="focus-shell shell-enter"
      style={
        {
          "--focus-rail-w": `${railCur}px`,
          "--focus-side-w": sideW !== null ? `${sideW}px` : undefined,
        } as CSSProperties
      }
    >
      <FocusTopBar configOpen={configOpen} onConfigToggle={setConfigOpen} />
      <div className="focus-body" ref={bodyRef} data-side-fixed={sideW !== null ? "1" : undefined}>
        <SessionRail />
        {railOpen && (
          <PaneResizer
            value={railCur}
            min={RAIL_W.min}
            max={Math.max(RAIL_W.min, room(rightOpen ? sideCur : 40, RAIL_W.max))}
            side="left"
            label={t("focus_resize_rail")}
            onChange={(w) => setFocusLayout({ railW: w })}
            onReset={() => setFocusLayout({ railW: null })}
          />
        )}
        <div className={"focus-conversation" + (emptyConversation ? " empty" : "")}>
          {emptyConversation && <FocusHero />}
          <ErrorBoundary label="conversation">
            <AgentPanel />
          </ErrorBoundary>
          {emptyConversation && <FocusExampleCards onOpenConfig={() => setConfigOpen(true)} />}
        </div>
        {rightOpen && (
          <PaneResizer
            value={sideCur}
            min={SIDE_W.min}
            max={Math.max(SIDE_W.min, room(railOpen ? railCur : 40, SIDE_W.max))}
            side="right"
            label={t("focus_resize_side")}
            onChange={(w) => setFocusLayout({ sideW: w })}
            onReset={() => setFocusLayout({ sideW: null })}
          />
        )}
        <ErrorBoundary label="side-panel">
          <FocusSidePanel />
        </ErrorBoundary>
      </div>
      <Notice />
    </div>
  );
}
