import { useState, type CSSProperties, type ReactNode } from "react";

import { type LucideIcon } from "lucide-react";

import { useI18n, type I18nKey, type Lang } from "../../i18n";
import { DEFAULT_ACCENT, useTheme, type Theme } from "../../store/theme";
import { ConnectionConfig } from "../agent/ConnectionConfig";
import { ICONS } from "../iconMap";
import { SectionedPanel } from "../SectionedPanel";
import { Segmented } from "../Segmented";

// 设置面板（SDD feats/01 v1.7 D23）——占据右侧工作区，左列分区导航、右列当前分区内容。
// 分区只做呈现编排：连接写 session.connection（ConnectionConfig），主题写 useTheme，语言写 I18nProvider。
type SectionId = "connection" | "appearance";
const SECTIONS: { id: SectionId; label: I18nKey; icon: LucideIcon }[] = [
  { id: "connection", label: "settings_connection", icon: ICONS.settingsConnection },
  { id: "appearance", label: "settings_appearance", icon: ICONS.settingsAppearance },
];

function SettingRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <b>{title}</b>
        <span>{desc}</span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

// 强调色预设（SDD feats/12 §7.2）——首项 null 即主题默认紫；其余避开语义色 good/warn/crit 与边界色。
const ACCENT_PRESETS = ["#6366f1", "#3b82f6", "#06b6d4", "#ec4899", "#64748b"];

/** 强调色：预设色块 + 原生取色器（任意色）+ 当前 hex + 恢复默认。 */
function AccentPicker() {
  const { t } = useI18n();
  const theme = useTheme((s) => s.theme);
  const accent = useTheme((s) => s.accent);
  const setAccent = useTheme((s) => s.setAccent);
  const current = accent ?? DEFAULT_ACCENT[theme];
  const custom = accent !== null && !ACCENT_PRESETS.includes(accent);
  const swatch = (c: string) => ({ "--swatch": c }) as CSSProperties;

  return (
    <div className="settings-accent">
      <div className="settings-swatches" role="radiogroup" aria-label={t("settings_accent")}>
        <button
          type="button"
          role="radio"
          aria-checked={accent === null}
          aria-label={t("settings_accent_default")}
          title={t("settings_accent_default")}
          className="settings-swatch"
          style={swatch(DEFAULT_ACCENT[theme])}
          onClick={() => setAccent(null)}
        />
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={accent === c}
            aria-label={c}
            title={c}
            className="settings-swatch"
            style={swatch(c)}
            onClick={() => setAccent(c)}
          />
        ))}
        <label
          className={"settings-swatch settings-swatch-custom" + (custom ? " on" : "")}
          style={custom ? swatch(current) : undefined}
          title={t("settings_accent_custom")}
        >
          <input
            type="color"
            aria-label={t("settings_accent_custom")}
            value={current}
            onChange={(e) => setAccent(e.target.value)}
          />
        </label>
      </div>
      <span className="settings-accent-hex mono">{current}</span>
      {accent !== null && (
        <button type="button" className="settings-link" onClick={() => setAccent(null)}>
          {t("settings_accent_reset")}
        </button>
      )}
    </div>
  );
}

function AppearanceSection() {
  const { t, lang, setLang } = useI18n();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <>
      <SettingRow title={t("settings_theme")} desc={t("settings_theme_desc")}>
        <Segmented<Theme>
          label={t("settings_theme")}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "dark", label: t("settings_theme_dark") },
            { value: "light", label: t("settings_theme_light") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("settings_accent")} desc={t("settings_accent_desc")}>
        <AccentPicker />
      </SettingRow>
      <SettingRow title={t("settings_lang")} desc={t("settings_lang_desc")}>
        {/* 语言名用各自语言书写，切换后仍认得出来 */}
        <Segmented<Lang>
          label={t("settings_lang")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />
      </SettingRow>
    </>
  );
}

export function SettingsPanel() {
  const { t } = useI18n();
  const [section, setSection] = useState<SectionId>("connection");

  return (
    <SectionedPanel
      title={t("settings_title")}
      sections={SECTIONS.map((s) => ({ id: s.id, label: t(s.label), icon: s.icon }))}
      current={section}
      onSelect={setSection}
      desc={section === "connection" ? t("settings_connection_desc") : undefined}
    >
      {section === "connection" && <ConnectionConfig variant="panel" />}
      {section === "appearance" && <AppearanceSection />}
    </SectionedPanel>
  );
}
