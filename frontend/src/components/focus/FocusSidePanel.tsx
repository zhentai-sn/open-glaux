import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { type LucideIcon } from "lucide-react";

import { useI18n, type I18nKey } from "../../i18n";
import {
  BROWSER_W,
  SIDE_SPLIT,
  STAGE_MIN,
  useSession,
  type FocusBrowserView,
} from "../../store/session";
import { AtlasView } from "../atlas/AtlasView";
import { Icon } from "../Icon";
import { ICONS, TAB_ICON } from "../iconMap";
import { ExplorerView } from "../SideBar";
import { PaneResizer } from "./PaneResizer";
import { StagePanel } from "./StagePanel";

// Focus 右侧栏（SDD feats/01 v1.4 §7-2 / §9 / D16–D18）——**舞台常驻**，文件/图谱降为与它左右
// 分栏的「浏览器列」。标签条只剩两枚开关：点未激活者打开该浏览器，点已激活者关掉浏览器列、
// 回到纯舞台（等价于 v1.1 的舞台标签）。折叠后仍是 40px 三图标竖条。
// 窄屏降级（§13）：实测侧栏宽放不下两列时退回 v1.1 的整栏互斥，并恢复「选图 → 回舞台」。
// 自身无领域逻辑，只读写 focusLayout 与自身实测宽度。

const BROWSERS: { id: FocusBrowserView; key: I18nKey; icon: LucideIcon }[] = [
  { id: "files", key: "focus_tab_files", icon: TAB_ICON.files },
  { id: "atlas", key: "focus_tab_atlas", icon: TAB_ICON.atlas },
];

export function FocusSidePanel() {
  const { t } = useI18n();
  const rightOpen = useSession((s) => s.focusLayout.rightOpen);
  const browserView = useSession((s) => s.focusLayout.browserView);
  const browserW = useSession((s) => s.focusLayout.browserW);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);

  // ---- 实测侧栏宽度：分栏判定与分隔条上界都读它 ----
  // 不读持久化的 sideW——它为 null（未拖过）时没有像素真相值，只有量出来的才是真的。
  const asideRef = useRef<HTMLElement>(null);
  const [measuredW, setMeasuredW] = useState(0);
  // 迟滞（SDD §9）：分栏 → 降级取 < enter，降级 → 分栏取 ≥ exit，避免临界宽度反复重排。
  const [split, setSplit] = useState(true);

  useLayoutEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return; // 首帧未布局：保持当前判定，不把 0 误判成窄屏
      setMeasuredW(w);
      setSplit((prev) => (prev ? w >= SIDE_SPLIT.enter : w >= SIDE_SPLIT.exit));
    };
    read();
    window.addEventListener("resize", read);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", read);
      ro?.disconnect();
    };
  }, [rightOpen, browserView, browserW]);

  // 窄屏降级态才保留「在文件浏览器选图 → 回舞台」（D17）：分栏态下两者同屏，
  // 自动切换只会把用户正在用的列表抢走，正是 D16 要消除的症状。
  const activeId = activeImage ?? activeVolume ?? activeSlide ?? null;
  const prevActive = useRef(activeId);
  useEffect(() => {
    if (prevActive.current !== activeId && !split && browserView === "files" && activeId) {
      setFocusLayout({ browserView: null });
    }
    prevActive.current = activeId;
  }, [activeId, split, browserView, setFocusLayout]);

  if (!rightOpen) {
    // 折叠态 40px 竖条：舞台图标 = 展开且不开浏览器；另两枚 = 展开并打开对应浏览器。
    return (
      <aside className="focus-side collapsed" aria-label={t("focus_side_panel")}>
        <button
          type="button"
          className={"focus-side-icon" + (browserView === null ? " on" : "")}
          title={t("focus_tab_stage")}
          aria-label={t("focus_tab_stage")}
          onClick={() => setFocusLayout({ rightOpen: true, browserView: null })}
        >
          <Icon icon={TAB_ICON.stage} size="lg" />
        </button>
        {BROWSERS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={"focus-side-icon" + (browserView === b.id ? " on" : "")}
            title={t(b.key)}
            aria-label={t(b.key)}
            onClick={() => setFocusLayout({ rightOpen: true, browserView: b.id })}
          >
            <Icon icon={b.icon} size="lg" />
          </button>
        ))}
      </aside>
    );
  }

  const hasBrowser = browserView !== null;
  const showSplit = hasBrowser && split; // 分栏：浏览器 + 分隔条 + 舞台
  const showStage = !hasBrowser || split; // 降级态下浏览器占满，舞台让位
  // 分隔条上界：既不超过 BROWSER_W.max，也不把舞台挤到 STAGE_MIN 以下。
  const browserMax =
    measuredW > 0
      ? Math.max(BROWSER_W.min, Math.min(BROWSER_W.max, measuredW - STAGE_MIN))
      : BROWSER_W.max;

  return (
    <aside
      className="focus-side"
      ref={asideRef}
      aria-label={t("focus_side_panel")}
      style={{ "--focus-browser-w": `${browserW ?? BROWSER_W.def}px` } as CSSProperties}
    >
      <div className="focus-side-tabs" role="tablist">
        {BROWSERS.map((b) => {
          const on = browserView === b.id;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={on}
              title={on ? t("focus_browser_close") : t(b.key)}
              className={"focus-side-tab" + (on ? " on" : "")}
              // 点已激活的标签 = 关掉浏览器列，回到纯舞台（D16：舞台不再是标签，故用 toggle 表达）
              onClick={() => setFocusLayout({ browserView: on ? null : b.id })}
            >
              <Icon icon={b.icon} size="sm" /> {t(b.key)}
            </button>
          );
        })}
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
      <div
        className="focus-side-body"
        data-view={browserView ?? "stage"}
        data-split={showSplit ? "1" : undefined}
      >
        {hasBrowser && (
          <div className="focus-side-browser">
            {browserView === "files" ? <ExplorerView /> : <AtlasView compact />}
          </div>
        )}
        {showSplit && (
          <PaneResizer
            value={browserW ?? BROWSER_W.def}
            min={BROWSER_W.min}
            max={browserMax}
            side="left"
            label={t("focus_resize_browser")}
            onChange={(w) => setFocusLayout({ browserW: w })}
            onReset={() => setFocusLayout({ browserW: null })}
          />
        )}
        {showStage && (
          <div className="focus-side-stage">
            <StagePanel />
          </div>
        )}
      </div>
    </aside>
  );
}
