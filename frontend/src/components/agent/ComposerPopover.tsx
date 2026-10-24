import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
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
 *
 * 弹层挂到 `document.body`（fixed 定位贴住触发按钮右缘、向上展开）：对话流是自身的滚动合成层，
 * 留在输入区内既会被 `.agent-conversation` 的 overflow 裁切，也会被 Chromium 画在文字之下。
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
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);

  // 打开前量触发按钮：弹层右缘与其右缘对齐，底边贴在其上方 10px。
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: Math.max(8, window.innerHeight - rect.top + 10),
    });
  }, [open]);

  // 依赖 anchor：弹层是下一帧才挂载的 portal，锚点就位后才聚焦得到。
  useEffect(() => {
    if (!open) return;
    popRef.current
      ?.querySelector<HTMLElement>("[data-autofocus], button:not(:disabled), [tabindex='0']")
      ?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 视口变化后锚点失效，直接收起而不是错位显示。
    const onViewport = () => setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onViewport);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onViewport);
    };
  }, [open, anchor]);

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
      {open && anchor && createPortal(
        <div
          ref={popRef}
          className={`composer-pop${className ? ` ${className}` : ""}`}
          role={role}
          aria-label={label}
          style={{ right: anchor.right, bottom: anchor.bottom, ...(width ? { width } : {}) }}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
