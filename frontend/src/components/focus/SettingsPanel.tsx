import { useState, type ReactNode } from "react";

import { type LucideIcon } from "lucide-react";

import { useI18n, type I18nKey, type Lang } from "../../i18n";
import { useTheme, type Theme } from "../../store/theme";
import { ConnectionConfig } from "../agent/ConnectionConfig";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 设置面板（SDD feats/01 v1.7 D23）——占据右侧工作区，左列分区导航、右列当前分区内容。
// 分区只做呈现编排：连接写 session.connection（ConnectionConfig），主题写 useTheme，语言写 I18nProvider。
type SectionId = "connection" | "appearance";
const SECTIONS: { id: SectionId; label: I18nKey; icon: LucideIcon }[] = [
  { id: "connection", label: "settings_connection", icon: ICONS.settingsConnection },
  { id: "appearance", label: "settings_appearance", icon: ICONS.settingsAppearance },
];

/** 单选分段控件：选项少且互斥（主题、语言），比下拉少一次点击。 */
function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="settings-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="settings">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings_title")}>
          <div className="settings-nav-title">{t("settings_title")}</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"settings-nav-item" + (s.id === section ? " on" : "")}
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              <Icon icon={s.icon} size="sm" /> {t(s.label)}
            </button>
          ))}
        </nav>
        <section className="settings-body" aria-label={t(current.label)}>
          <h2>{t(current.label)}</h2>
          {section === "connection" && (
            <>
              <p className="settings-desc">{t("settings_connection_desc")}</p>
              <ConnectionConfig variant="panel" />
            </>
          )}
          {section === "appearance" && <AppearanceSection />}
        </section>
      </div>
    </div>
  );
}
