import { Fragment, type ReactNode } from "react";

import { type LucideIcon } from "lucide-react";

import { Icon } from "./Icon";

/** 竖向分区导航中的一项；`group` 变化处插入组标题，`disabled` 置灰且不可切换。 */
export interface PanelSection<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
  group?: string;
  disabled?: boolean;
  /** 不可用时的悬停提示。 */
  hint?: string;
}

/**
 * 左列分区导航 + 右列当前分区内容（设置页 SDD 01 v1.7 D23；上下文页 SDD 19 §7.1 规则 3）。
 * 容器窄于 520px 时导航改为顶部横排（样式见 `.settings`）。
 */
export function SectionedPanel<Id extends string>({
  title,
  sections,
  current,
  onSelect,
  desc,
  children,
  testId,
}: {
  title: string;
  sections: readonly PanelSection<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  desc?: string;
  children: ReactNode;
  testId?: string;
}) {
  const active = sections.find((s) => s.id === current) ?? sections[0]!;
  return (
    <div className="settings" data-testid={testId}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={title}>
          <div className="settings-nav-title">{title}</div>
          {sections.map((s, i) => (
            <Fragment key={s.id}>
              {s.group && s.group !== sections[i - 1]?.group && (
                <div className="settings-nav-group">{s.group}</div>
              )}
              <button
                type="button"
                className={"settings-nav-item" + (s.id === active.id ? " on" : "") + (s.disabled ? " off" : "")}
                aria-current={s.id === active.id ? "page" : undefined}
                aria-disabled={s.disabled ? "true" : undefined}
                title={s.disabled ? s.hint : undefined}
                onClick={() => !s.disabled && onSelect(s.id)}
              >
                <Icon icon={s.icon} size="sm" /> {s.label}
                {s.disabled && s.hint && <span className="settings-nav-hint">{s.hint}</span>}
              </button>
            </Fragment>
          ))}
        </nav>
        <section className="settings-body" aria-label={active.label}>
          <h2>{active.label}</h2>
          {desc && <p className="settings-desc">{desc}</p>}
          {children}
        </section>
      </div>
    </div>
  );
}
