import { useState } from "react";

import type { TaskAction } from "../api/types";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";
import type { EditorChrome } from "../viewer/editorChrome";
import { Icon } from "./Icon";
import { ACTION_ICON } from "./iconMap";

// 编辑区动作段（SDD 04 §7.5）：一次性命令，普通按钮、无选中态；执行中与不可执行时禁用，
// 原因经 title 呈现。无任务对象不渲染（规则 5）。两种外壳共用，只换按钮样式。
// 按钮直接作为工具条子元素返回：Focus 的紧凑判据（useCompactToolbar）按 .focus-tool 计宽。
export function EditorActions({ chrome, variant }: { chrome: EditorChrome; variant: "focus" | "workbench" }) {
  const { t } = useI18n();
  const focus = useSession((s) => s.focus);
  const loading = useSession((s) => s.loading);
  const [pending, setPending] = useState<ReadonlySet<TaskAction>>(new Set());
  const { task, actions } = chrome;
  if (!task || actions.length === 0) return null;

  const run = async (id: TaskAction, exec: () => Promise<void>) => {
    setPending((prev) => new Set(prev).add(id));
    try {
      await exec();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <>
      {actions.map((action) => {
        const busy = pending.has(action.id);
        const reason = action.blocked({ task, focus, loading });
        const label = t(busy && action.busyLabel ? action.busyLabel : action.label);
        const title = reason ? t(reason) : label;
        const onClick = () => void run(action.id, action.run);
        return variant === "focus" ? (
          <button key={action.id} className="focus-tool focus-action" disabled={busy || reason !== null} aria-label={label} title={title} onClick={onClick}>
            <Icon icon={ACTION_ICON[action.id]} size="sm" /> <span>{label}</span>
          </button>
        ) : (
          <button key={action.id} className="etool" disabled={busy || reason !== null} aria-label={label} onClick={onClick}>
            <Icon icon={ACTION_ICON[action.id]} size="sm" />
            <span className="tip">{title}</span>
          </button>
        );
      })}
    </>
  );
}
