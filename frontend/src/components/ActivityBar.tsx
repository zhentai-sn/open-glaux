import { type LucideIcon } from "lucide-react";

import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type View } from "../store/session";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 侧边栏入口——只留 资源管理器 + 插件市场（去掉搜索/源代码管理，见设计稿 §6）。图标统一走 lucide（SDD feats/06）。
const VIEWS: { id: View; key: "av_explorer" | "av_market" | "av_atlas"; icon: LucideIcon }[] = [
  { id: "explorer", key: "av_explorer", icon: ICONS.explorer },
  { id: "market", key: "av_market", icon: ICONS.market },
  { id: "atlas", key: "av_atlas", icon: ICONS.atlas },
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
          <Icon icon={v.icon} size="xl" />
          <span className="tip">{t(v.key)}</span>
          {v.id === "market" && nInstalled > 0 && <span className="badge">{nInstalled}</span>}
        </button>
      ))}
      <button className="act" onClick={() => void reRunActiveModel()}>
        <Icon icon={ICONS.run} size="xl" />
        <span className="tip">{t("av_run")}</span>
      </button>
    </nav>
  );
}
