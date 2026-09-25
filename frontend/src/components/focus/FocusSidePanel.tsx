import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "../../i18n";
import { BROWSER_W, SIDE_SPLIT, STAGE_MIN, useSession } from "../../store/session";
import { AtlasView } from "../atlas/AtlasView";
import { ExplorerView } from "../SideBar";
import { PaneResizer } from "./PaneResizer";
import { SettingsPanel } from "./SettingsPanel";
import { StagePanel } from "./StagePanel";

// Focus 右侧栏（SDD feats/01 v1.7 §7-2 / §9 / D16–D23）——纯内容区，没有自己的标签条与折叠竖条；
// 舞台 / 文件 / 图谱 / 设置的入口统一在左侧栏（SessionRail）。
// 工作区是舞台、图谱或设置（sideView），占同一位置互换；舞台态下文件是与舞台左右分栏的浏览器列。
// 窄屏降级（§13）：实测侧栏宽放不下两列时退回整栏互斥，并恢复「选图 → 回舞台」。
// 自身无领域逻辑，只读写 focusLayout 与自身实测宽度。

export function FocusSidePanel() {
  const { t } = useI18n();
  const rightOpen = useSession((s) => s.focusLayout.rightOpen);
  const sideView = useSession((s) => s.focusLayout.sideView);
  const browserView = useSession((s) => s.focusLayout.browserView);
  const browserW = useSession((s) => s.focusLayout.browserW);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const activeId = useSession((s) => s.focus?.object_id ?? null);

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
  }, [rightOpen, sideView, browserView, browserW]);

  // 窄屏降级态才保留「在文件浏览器选图 → 回舞台」（D17）：分栏态下两者同屏，
  // 自动切换只会把用户正在用的列表抢走，正是 D16 要消除的症状。
  const prevActive = useRef(activeId);
  useEffect(() => {
    if (prevActive.current !== activeId && !split && browserView === "files" && activeId) {
      setFocusLayout({ browserView: null });
    }
    prevActive.current = activeId;
  }, [activeId, split, browserView, setFocusLayout]);

  // 收起时整栏不渲染：重新打开走左侧栏入口或 Ctrl/Cmd+\（v1.6 D22）。
  if (!rightOpen) return null;

  if (sideView === "settings") {
    return (
      <aside className="focus-side" ref={asideRef} aria-label={t("focus_side_panel")}>
        <SettingsPanel />
      </aside>
    );
  }

  if (sideView === "atlas") {
    return (
      <aside className="focus-side" ref={asideRef} aria-label={t("focus_side_panel")}>
        <div className="focus-side-body" data-view="atlas">
          <div className="focus-side-browser">
            <AtlasView />
          </div>
        </div>
      </aside>
    );
  }

  const hasBrowser = browserView !== null;
  const showSplit = hasBrowser && split; // 分栏：舞台 + 分隔条 + 文件列
  const showStage = !hasBrowser || split; // 降级态下文件列占满，舞台让位
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
      <div
        className="focus-side-body"
        data-view={hasBrowser ? "files" : "stage"}
        data-split={showSplit ? "1" : undefined}
      >
        {/* D19：舞台在左、文件列贴最右缘——对话谈论的正是舞台上那张图，二者相邻。 */}
        {showStage && (
          <div className="focus-side-stage">
            <StagePanel />
          </div>
        )}
        {showSplit && (
          <PaneResizer
            value={browserW ?? BROWSER_W.def}
            min={BROWSER_W.min}
            max={browserMax}
            side="right"
            label={t("focus_resize_browser")}
            onChange={(w) => setFocusLayout({ browserW: w })}
            onReset={() => setFocusLayout({ browserW: null })}
          />
        )}
        {hasBrowser && (
          <div className="focus-side-browser">
            <ExplorerView />
          </div>
        )}
      </div>
    </aside>
  );
}
