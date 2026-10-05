import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

import type { PermissionMode } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

const MODES: { mode: PermissionMode; icon: LucideIcon }[] = [
  { mode: "observe", icon: ICONS.permObserve },
  { mode: "suggest", icon: ICONS.permSuggest },
  { mode: "controlled", icon: ICONS.permControlled },
  { mode: "autonomous", icon: ICONS.permAutonomous },
];

// 输入框底栏的权限模式菜单（SDD 15 §7.4）：向上弹出，每项图标 + 名称 + 一句说明，当前项打勾。
// 切到 autonomous 前的确认由调用方在 onChange 里做。
export function PermissionMenu({
  value,
  disabled,
  onChange,
}: {
  value: PermissionMode;
  disabled: boolean;
  onChange: (mode: PermissionMode) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = MODES.find((item) => item.mode === value) ?? MODES[2]!;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[MODES.findIndex((item) => item.mode === value)]?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, value]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (mode: PermissionMode) => {
    close();
    if (mode !== value) onChange(mode);
  };
  const onMenuKey = (event: KeyboardEvent) => {
    const items = itemRefs.current;
    const at = items.findIndex((el) => el === document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="permission-menu-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-permission${open ? " open" : ""}`}
        title={t(`agent_permission_${value}_hint`)}
        aria-label={`${t("agent_permission")}: ${t(`agent_permission_${value}`)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={current.icon} size="sm" />
        <span>{t(`agent_permission_${value}`)}</span>
        <Icon icon={open ? ICONS.chevronUp : ICONS.chevronDown} size="sm" />
      </button>
      {open && (
        <div className="permission-menu" role="menu" aria-label={t("agent_permission")} onKeyDown={onMenuKey}>
          {MODES.map((item, index) => (
            <button
              key={item.mode}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={item.mode === value}
              onClick={() => choose(item.mode)}
            >
              <Icon icon={item.icon} size="sm" />
              <span className="permission-menu-text">
                <b>{t(`agent_permission_${item.mode}`)}</b>
                <small>{t(`agent_permission_${item.mode}_hint`)}</small>
              </span>
              {item.mode === value && <Icon icon={ICONS.check} size="sm" className="permission-menu-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
