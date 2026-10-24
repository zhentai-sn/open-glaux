import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

import type { PermissionMode } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { ComposerPopover } from "./ComposerPopover";

const MODES: { mode: PermissionMode; icon: LucideIcon }[] = [
  { mode: "observe", icon: ICONS.permObserve },
  { mode: "suggest", icon: ICONS.permSuggest },
  { mode: "controlled", icon: ICONS.permControlled },
  { mode: "autonomous", icon: ICONS.permAutonomous },
];

// 输入区底栏的权限模式胶囊（SDD 15 §7.4）：向上弹出，每项图标 + 名称 + 一句说明，当前项打勾。
// 切到 autonomous 前的确认由调用方在 onChange 里做。外壳与其余胶囊同构（SDD 00 §5.2）。
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
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = MODES.find((item) => item.mode === value) ?? MODES[2]!;

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = itemRefs.current;
    const at = items.findIndex((element) => element === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <ComposerPopover
      label={`${t("agent_permission")}: ${t(`agent_permission_${value}`)}`}
      tip={t(`agent_permission_${value}_hint`)}
      icon={<Icon icon={current.icon} size="sm" />}
      text={t(`agent_permission_${value}`)}
      disabled={disabled}
      width={300}
      role="menu"
      className="composer-pop--permission"
      onKeyDown={onMenuKey}
    >
      {(close) => (
        <div className="permission-menu">
          {MODES.map((item, index) => (
            <button
              key={item.mode}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitemradio"
              aria-checked={item.mode === value}
              {...(item.mode === value ? { "data-autofocus": true } : {})}
              onClick={() => {
                close();
                if (item.mode !== value) onChange(item.mode);
              }}
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
    </ComposerPopover>
  );
}
