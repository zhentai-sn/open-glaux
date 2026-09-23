import { useI18n } from "../i18n";
import { SHORTCUT_GROUP_LABEL, shortcutRowsFor, type ShortcutGroup } from "../keys/globalKeys";
import { useSession } from "../store/session";

// 快捷键速查面板（SDD feats/05 §1.3）——? 唤起的 overlay，按分组列出当前生效快捷键。
// 数据来自 SHORTCUT_ROWS 单一真相源；Esc/? 关闭由全局分发器处理，点遮罩也可关。
const GROUPS: ShortcutGroup[] = ["tool", "shell", "help"];

export function ShortcutSheet() {
  const open = useSession((s) => s.shortcutSheetOpen);
  const setOpen = useSession((s) => s.setShortcutSheet);
  const state = useSession((s) => s);
  const { t, lang } = useI18n();
  const rows = shortcutRowsFor(state);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={() => setOpen(false)}>
      <div
        className="sheet notice-enter"
        role="dialog"
        aria-modal="true"
        aria-label={t("sc_title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-hd">{t("sc_title")}</div>
        <div className="sheet-groups">
          {GROUPS.filter((g) => rows.some((r) => r.group === g)).map((g) => (
            <div key={g} className="sheet-group">
              <div className="sheet-group-title">{t(SHORTCUT_GROUP_LABEL[g])}</div>
              {rows.filter((r) => r.group === g).map((r) => (
                <div key={r.keys} className={`sheet-row${r.disabled ? " disabled" : ""}`} aria-disabled={r.disabled || undefined}>
                  <span className="sheet-label">{r.label ? t(r.label) : r.text?.[lang]}</span>
                  <kbd className="sheet-keys mono">{r.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sheet-ft">{t("sc_dismiss")}</div>
      </div>
    </div>
  );
}
