import { ModeSwitch } from "./focus/ModeSwitch";
import { OwlLogo } from "./OwlLogo";
import { datasourceOf, displayName } from "../data/objectInfo";
import { useI18n } from "../i18n";
import { activeObject, useSession } from "../store/session";

// 只留产品标识、宗旨与真实标题（当前图），不放无行为的顶层菜单与假窗口控件。
export function TitleBar() {
  const { t } = useI18n();
  const obj = useSession((s) => activeObject(s));
  const ws = useSession((s) => datasourceOf(s.datasources, obj)?.name ?? "");
  // 标题 = 对象展示名 — 所属数据源名；不按模态猜扩展名与数据集名（SDD 10 §8.3）。
  return (
    <div className="titlebar">
      <span className="logo" aria-hidden="true">
        <OwlLogo />
      </span>
      <b style={{ fontSize: 12, color: "var(--bright)", marginRight: 4 }}>Glaux</b>
      <span style={{ fontSize: 11, color: "var(--faint)" }}>
        · {t("focus_tagline")}
      </span>
      <span className="ttl">{obj ? `${displayName(obj)} — ${ws}` : ws}</span>
      <ModeSwitch />
    </div>
  );
}
