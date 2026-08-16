import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type View } from "../store/session";

// 侧边栏入口——只留 资源管理器 + 插件市场（去掉搜索/源代码管理，见设计稿 §6）。
const VIEWS: { id: View; key: "av_explorer" | "av_market" | "av_atlas"; icon: JSX.Element }[] = [
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
  {
    // 图谱（SDD feats/03）：打开的书
    id: "atlas",
    key: "av_atlas",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 6c-1.5-1.3-3.5-2-6-2H4v14h2c2.5 0 4.5.7 6 2 1.5-1.3 3.5-2 6-2h2V4h-2c-2.5 0-4.5.7-6 2z" />
        <path d="M12 6v14" />
      </svg>
    ),
  },
];

export function ActivityBar() {
  const { t } = useI18n();
  const view = useSession((s) => s.sidebarView);
  const setView = useSession((s) => s.setSidebarView);
  const nInstalled = useSession((s) => s.models.length);
  // Run 按钮：直接重跑当前模态的活动模型（退役 orchestration P3：不再绕道 NL 意图闸门）。

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
      <button className="act" onClick={() => void reRunActiveModel()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M7 5l12 7-12 7V5z" />
        </svg>
        <span className="tip">{t("av_run")}</span>
      </button>
    </nav>
  );
}
