import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 模式切换（SDD feats/01 §8）——无状态按钮，两模式顶栏共用。
// 切换是纯视图动作：写 store（含 localStorage 持久化），零请求、零数据搬运。
export function ModeSwitch() {
  const { t } = useI18n();
  const uiMode = useSession((s) => s.uiMode);
  const setUiMode = useSession((s) => s.setUiMode);
  const toWorkbench = uiMode === "focus";
  return (
    <button
      className="mode-switch"
      type="button"
      onClick={() => setUiMode(toWorkbench ? "workbench" : "focus")}
    >
      <Icon icon={ICONS.swap} size="sm" /> {t(toWorkbench ? "mode_to_workbench" : "mode_to_focus")}
    </button>
  );
}
