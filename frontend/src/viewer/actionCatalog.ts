import type { Focus, TaskAction, TaskView } from "../api/types";
import { reRunActiveModel, verifyActiveObject } from "../data/actions";
import type { I18nKey } from "../i18n";

// 任务动作目录（SDD 04 §7.5、D-22）——一次性命令，调后端；只在有 TaskView 时出现（规则 5）。
// 图标在 components/iconMap 的 ACTION_ICON（SDD 06 单一图标源）。
export interface ActionContext {
  task: TaskView;
  focus: Focus | null;
  loading: boolean;
}

export interface ActionEntry {
  id: TaskAction;
  label: I18nKey;
  /** 执行中的按钮文案；缺省沿用 label。 */
  busyLabel?: I18nKey;
  run(): Promise<void>;
  /** 不可执行的原因（按钮禁用并以 title 呈现）；可执行为 null。 */
  blocked(ctx: ActionContext): I18nKey | null;
}

export const ACTION_CATALOG: Record<TaskAction, ActionEntry> = {
  // 规则 6：以当前选区与活动模型重跑，不清标注、不改当前模式。
  rerun: {
    id: "rerun",
    label: "act_rerun",
    run: reRunActiveModel,
    blocked: ({ task, focus, loading }) => {
      if (loading) return "running";
      if (task.trigger === "on_region" && !focus?.region) return "act_rerun_need_region";
      return null;
    },
  },
  // 规则 7：结果写 store.verification，由读数条呈现。
  verify: {
    id: "verify",
    label: "act_verify",
    busyLabel: "act_verifying",
    run: verifyActiveObject,
    blocked: () => null,
  },
};
