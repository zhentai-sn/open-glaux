// 标签目录（SDD 23 §7.1–§7.2）：当前对象作用域的目录、按作用域记忆的当前标签、标签弹层请求。
// 作用域由 backend 按对象解析；这里只缓存「当前对象所在作用域」的一份目录。
import { create } from "zustand";

import { ApiError, api } from "../api/client";
import type { Label } from "../api/types";
import { useSession } from "./session";

/** 标签弹层的一次请求：选中或新建后以标签兑现，取消以 null 兑现。 */
export interface LabelRequest {
  objectId: string;
  /** 预填的搜索文本（确认未入目录的建议时为其文本，§7.5 规则 4）。 */
  prefill: string;
  /** 选定后是否设为当前标签（绘制流程为 true）。 */
  setCurrent: boolean;
  resolve: (label: Label | null) => void;
}

interface LabelsState {
  objectId: string | null;
  scope: string | null;
  labels: Label[];
  /** 按作用域记忆的当前标签（§7.2 规则 3）。 */
  currentByScope: Record<string, string | null>;
  /** 查看器上显示标签名（工具条开关）。 */
  showNames: boolean;
  request: LabelRequest | null;
  load: (objectId: string) => Promise<void>;
  setCurrent: (labelId: string | null) => void;
  setShowNames: (show: boolean) => void;
  /** 新建；同名已存在时取回已有标签（§10）。失败返回 null 并提示。 */
  createLabel: (objectId: string, name: string, color?: string) => Promise<Label | null>;
  updateLabel: (id: string, patch: { name?: string; color?: string; description?: string; sort?: number }) => Promise<boolean>;
  /** 删除；被引用时返回引用条数（§7.1 规则 7）。 */
  deleteLabel: (id: string) => Promise<{ ok: true } | { ok: false; count?: number }>;
  mergeLabel: (id: string, into: string) => Promise<boolean>;
  /** 打开标签弹层，等待用户选择、新建或取消。 */
  requestLabel: (objectId: string, opts?: { prefill?: string; setCurrent?: boolean }) => Promise<Label | null>;
  settle: (label: Label | null) => void;
}

function notify(message: string) {
  useSession.getState().notify("crit", message);
}

/** 目录改动后刷新当前对象的标注，使名称、颜色与计数跟上（§7.1 规则 6）。 */
async function refreshFocusedAnnotations(): Promise<void> {
  const { focus, setAnnotations } = useSession.getState();
  if (!focus) return;
  try {
    const { annotations } = await api.annotations.list(focus.object_id, focus.index);
    if (useSession.getState().focus?.object_id === focus.object_id) setAnnotations(annotations);
  } catch {
    /* 刷新失败不影响目录操作 */
  }
}

export const useLabels = create<LabelsState>((set, get) => ({
  objectId: null,
  scope: null,
  labels: [],
  currentByScope: {},
  showNames: true,
  request: null,

  load: async (objectId) => {
    try {
      const { scope, labels } = await api.labels.list(objectId);
      set({ objectId, scope, labels });
    } catch {
      set({ objectId, scope: null, labels: [] });
    }
  },

  setCurrent: (labelId) => {
    const { scope } = get();
    if (!scope) return;
    set((s) => ({ currentByScope: { ...s.currentByScope, [scope]: labelId } }));
  },

  setShowNames: (show) => set({ showNames: show }),

  createLabel: async (objectId, name, color) => {
    try {
      const { label } = await api.labels.create({ object_id: objectId, name, ...(color ? { color } : {}) });
      await get().load(objectId);
      return label;
    } catch (err) {
      if (err instanceof ApiError && err.code === "LABEL_EXISTS") {
        await get().load(objectId);
        const existing = err.extra?.label as Label | undefined;
        return get().labels.find((l) => l.id === existing?.id) ?? null;
      }
      notify(err instanceof ApiError ? err.message : "标签未创建（后端失败）");
      return null;
    }
  },

  updateLabel: async (id, patch) => {
    const label = get().labels.find((l) => l.id === id);
    if (!label) return false;
    try {
      await api.labels.update(id, { base_seq: label.seq, ...patch });
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "标签未更新（后端失败）");
      if (get().objectId) await get().load(get().objectId!);
      return false;
    }
    if (get().objectId) await get().load(get().objectId!);
    await refreshFocusedAnnotations();
    return true;
  },

  deleteLabel: async (id) => {
    const label = get().labels.find((l) => l.id === id);
    if (!label) return { ok: false };
    try {
      await api.labels.remove(id, label.seq);
    } catch (err) {
      if (err instanceof ApiError && err.code === "LABEL_IN_USE") return { ok: false, count: Number(err.extra?.count ?? 0) };
      notify(err instanceof ApiError ? err.message : "标签未删除（后端失败）");
      return { ok: false };
    }
    set((s) => ({
      currentByScope: Object.fromEntries(Object.entries(s.currentByScope).map(([k, v]) => [k, v === id ? null : v])),
    }));
    if (get().objectId) await get().load(get().objectId!);
    return { ok: true };
  },

  mergeLabel: async (id, into) => {
    const label = get().labels.find((l) => l.id === id);
    if (!label) return false;
    try {
      await api.labels.merge(id, label.seq, into);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "标签未合并（后端失败）");
      return false;
    }
    set((s) => ({
      currentByScope: Object.fromEntries(Object.entries(s.currentByScope).map(([k, v]) => [k, v === id ? into : v])),
    }));
    if (get().objectId) await get().load(get().objectId!);
    await refreshFocusedAnnotations();
    return true;
  },

  requestLabel: (objectId, opts = {}) =>
    new Promise<Label | null>((resolve) => {
      get().request?.resolve(null); // 同一时刻只开一个弹层
      set({ request: { objectId, prefill: opts.prefill ?? "", setCurrent: opts.setCurrent ?? false, resolve } });
    }),

  settle: (label) => {
    const request = get().request;
    if (!request) return;
    set({ request: null });
    if (label && request.setCurrent) get().setCurrent(label.id);
    request.resolve(label);
  },
}));

/** 当前作用域的当前标签；目录中已不存在时视为无。 */
export function currentLabel(state: Pick<LabelsState, "scope" | "labels" | "currentByScope"> = useLabels.getState()): Label | null {
  const id = state.scope ? state.currentByScope[state.scope] : null;
  return (id && state.labels.find((l) => l.id === id)) || null;
}

/**
 * 绘制时取标签（§7.2 规则 2）：有当前标签直接用；否则弹出标签弹层。取消返回 null，调用方丢弃形状。
 */
export async function chooseLabelForDrawing(objectId: string): Promise<Label | null> {
  const store = useLabels.getState();
  if (store.objectId !== objectId) await store.load(objectId);
  const current = currentLabel();
  if (current) return current;
  return useLabels.getState().requestLabel(objectId, { setCurrent: true });
}
