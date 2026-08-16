import { useI18n } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { ExemplarDetail } from "./ExemplarDetail";
import { ExemplarList } from "./ExemplarList";
import { ImportWizard } from "./ImportWizard";

// 图谱页面根组件（SDD feats/03 §8）：同一组件挂在 Workbench 左侧栏与 Focus 右侧拓展区，
// 按 useAtlasUi.screen 在列表 / 详情 / 导入向导间切换；样式在 Focus 内以 .focus-shell .atlas-view 收窄。
export function AtlasView({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const screen = useAtlasUi((s) => s.screen);
  const selectedId = useAtlasUi((s) => s.selectedId);
  const openImport = useAtlasUi((s) => s.openImport);

  return (
    <div className={"atlas-view" + (compact ? " compact" : "")} data-testid="atlas-view">
      {screen === "list" && (
        <div className="atlas-head">
          <div>
            <b>{t("atlas_title")}</b>
            <span className="atlas-sub">{t("atlas_subtitle")}</span>
          </div>
          <button type="button" className="dsbtn" onClick={openImport}>
            ＋ {t("atlas_import")}
          </button>
        </div>
      )}
      {screen === "list" && <ExemplarList />}
      {screen === "detail" && selectedId && <ExemplarDetail id={selectedId} />}
      {screen === "import" && <ImportWizard />}
    </div>
  );
}
