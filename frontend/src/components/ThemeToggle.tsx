import { useI18n } from "../i18n";
import { useTheme } from "../store/theme";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 主题切换按钮（SDD feats/12）——图标表示点击后的目标主题；样式类由所在栏位传入。
export function ThemeToggle({ className }: { className: string }) {
  const { t } = useI18n();
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const label = t(theme === "dark" ? "theme_to_light" : "theme_to_dark");
  return (
    <button type="button" className={className} title={label} aria-label={label} onClick={toggleTheme}>
      <Icon icon={theme === "dark" ? ICONS.themeLight : ICONS.themeDark} size="sm" />
    </button>
  );
}
