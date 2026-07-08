import { useAgent } from "../agent/useAgent";
import { useI18n } from "../i18n";
import { useSession, type View } from "../store/session";

// 侧边栏入口——只留 资源管理器 + 插件市场（去掉搜索/源代码管理，见设计稿 §6）。
const VIEWS: { id: View; key: "av_explorer" | "av_market"; icon: JSX.Element }[] = [
  {
    id: "explorer",
    key: "av_explorer",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M13 3H5v18h14V9l-6-6z" />
        <path d="M13 3v6h6" />
      </svg>
    ),
  },
  {
    id: "market",
    key: "av_market",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M17.5 14v7M14 17.5h7" />
      </svg>
    ),
  },
];

export function ActivityBar() {
  const { t, lang } = useI18n();
  const view = useSession((s) => s.sidebarView);
  const setView = useSession((s) => s.setSidebarView);
  const nInstalled = useSession((s) => s.models.length);
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const { run } = useAgent();
  // Run 按钮：跑当前模态的任务（提示词由注册表标签生成，命中意图信号），不硬编码 seed。
  const seedPrompt = () => {
    const label = tasks.find((tk) => tk.modality === modality)?.label[lang] ?? "";
    return t("seed_task", { task: label });
  };

  return (
    <nav className="activity">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className="act"
          aria-selected={view === v.id}
          onClick={() => setView(v.id)}
        >
          {v.icon}
          <span className="tip">{t(v.key)}</span>
          {v.id === "market" && nInstalled > 0 && <span className="badge">{nInstalled}</span>}
        </button>
      ))}
      <button className="act" onClick={() => run(seedPrompt())}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M7 5l12 7-12 7V5z" />
        </svg>
        <span className="tip">{t("av_run")}</span>
      </button>
    </nav>
  );
}
