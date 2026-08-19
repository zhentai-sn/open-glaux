import { useEffect, useRef } from "react";

import { type LucideIcon } from "lucide-react";

import { useI18n, type I18nKey } from "../../i18n";
import { useSession, type FocusRightView } from "../../store/session";
import { AtlasView } from "../atlas/AtlasView";
import { Icon } from "../Icon";
import { ICONS, TAB_ICON } from "../iconMap";
import { ExplorerView } from "../SideBar";
import { StagePanel } from "./StagePanel";

// Focus 右侧栏（SDD feats/01 v1.1 §7-2 / §8 / D10–D13）——参考 Codex 桌面端右侧面板：
// 常驻可折叠，顶部标签条切 舞台 / 文件 / 图谱 三种内容，一次只显示一个；折叠后收成 40px 图标竖条
// （与左侧会话栏对称），点图标即展开到该标签。自身无领域逻辑，只读写 focusLayout。
// 自动切换（§7-2）：在文件标签选中图像 → 切到舞台；其余不抢用户手选的标签。

const TABS: { id: FocusRightView; key: I18nKey; icon: LucideIcon }[] = [
  { id: "stage", key: "focus_tab_stage", icon: TAB_ICON.stage },
  { id: "files", key: "focus_tab_files", icon: TAB_ICON.files },
  { id: "atlas", key: "focus_tab_atlas", icon: TAB_ICON.atlas },
];

export function FocusSidePanel() {
  const { t } = useI18n();
  const rightOpen = useSession((s) => s.focusLayout.rightOpen);
  const rightView = useSession((s) => s.focusLayout.rightView);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);

  // 文件标签里选图 → 自动切到舞台（只在活动对象真的变化时触发，不抢首次挂载）
  const activeId = activeImage ?? activeVolume ?? activeSlide ?? null;
  const prevActive = useRef(activeId);
  useEffect(() => {
    if (prevActive.current !== activeId && rightView === "files" && activeId) {
      setFocusLayout({ rightView: "stage" });
    }
    prevActive.current = activeId;
  }, [activeId, rightView, setFocusLayout]);

  if (!rightOpen) {
    return (
      <aside className="focus-side collapsed" aria-label={t("focus_side_panel")}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={"focus-side-icon" + (rightView === tab.id ? " on" : "")}
            title={t(tab.key)}
            aria-label={t(tab.key)}
            onClick={() => setFocusLayout({ rightOpen: true, rightView: tab.id })}
          >
            <Icon icon={tab.icon} size="lg" />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="focus-side" aria-label={t("focus_side_panel")}>
      <div className="focus-side-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={rightView === tab.id}
            className={"focus-side-tab" + (rightView === tab.id ? " on" : "")}
            onClick={() => setFocusLayout({ rightView: tab.id })}
          >
            <Icon icon={tab.icon} size="sm" /> {t(tab.key)}
          </button>
        ))}
        <span className="focus-side-grow" />
        <button
          type="button"
          className="focus-side-collapse"
          title={t("focus_side_collapse")}
          aria-label={t("focus_side_collapse")}
          onClick={() => setFocusLayout({ rightOpen: false })}
        >
          <Icon icon={ICONS.chevronRight} size="sm" />
        </button>
      </div>
      <div className="focus-side-body" data-view={rightView}>
        {rightView === "stage" && <StagePanel />}
        {rightView === "files" && <ExplorerView />}
        {rightView === "atlas" && <AtlasView compact />}
      </div>
    </aside>
  );
}
