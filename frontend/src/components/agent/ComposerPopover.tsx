import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

interface ComposerPopoverProps {
  /** 触发按钮与弹层的无障碍名称。 */
  label: string;
  /** 悬停提示（缺省与 `label` 相同）。 */
  tip?: string;
  /** 触发按钮的前置图标（可选）。 */
  icon?: ReactNode;
  /** 触发按钮的文本。 */
  text: ReactNode;
  /** 文本后的弱化后缀（档位、百分比等）。 */
  suffix?: ReactNode;
  disabled?: boolean;
  /** 弹层宽度（px）；缺省由内容决定。 */
  width?: number;
  /** 弹层的语义：`dialog` 是信息面板，`menu` 是选项列表。 */
  role?: "dialog" | "menu";
  /** 触发按钮是否带展开箭头（信息面板不必）。 */
  chevron?: boolean;
  /** 打开时的回调（取数、清错误）。 */
  onOpen?: () => void;
  /** 弹层自身的键盘处理（列表导航）。Esc 已由本组件处理。 */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** 追加到弹层的类名。 */
  className?: string;
  children: (close: () => void) => ReactNode;
}

/**
 * 输入区胶囊与向上弹层的共用外壳（SDD 00 §5.2）：
 * 触发按钮复用 `.composer-pill`，弹层复用 `.composer-pop`；点外关闭、Esc 关闭并回到触发按钮，
 * 打开时聚焦 `[data-autofocus]` 或第一个可聚焦元素。
 */
export function ComposerPopover({
  label,
  tip,
  icon,
  text,
  suffix,
  disabled,
  width,
  role = "dialog",
  chevron = true,
  onOpen,
  onKeyDown,
  className,
  children,
}: ComposerPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    popRef.current
      ?.querySelector<HTMLElement>("[data-autofocus], button:not(:disabled), [tabindex='0']")
      ?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="composer-pop-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-pill${open ? " open" : ""}`}
        title={tip ?? label}
        aria-label={label}
        aria-haspopup={role}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) return close();
          onOpen?.();
          setOpen(true);
        }}
      >
        {icon}
        <span className="composer-pill-text">{text}</span>
        {suffix}
        {chevron && <Icon icon={open ? ICONS.chevronUp : ICONS.chevronDown} size="sm" />}
      </button>
      {open && (
        <div
          ref={popRef}
          className={`composer-pop${className ? ` ${className}` : ""}`}
          role={role}
          aria-label={label}
          style={width ? { width } : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
              return;
            }
            onKeyDown?.(event);
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
