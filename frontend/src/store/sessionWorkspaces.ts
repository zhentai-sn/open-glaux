// 会话工作区：查看对象、工具结果与输入草稿按会话各存一份（SDD 13 §7.7、§9.6）。
// 组件照旧读 useSession；切换会话时由 agentSessions 调 save / restore 换入换出（D-8）。
// 后台会话的 run_task 结果写进它自己的快照，不碰前台查看器（§7.7 规则 5）。
import { api } from "../api/client";
import type { Focus, Measure, Modality, Primitive } from "../api/types";
import type { Attachment } from "../agent/attachments";
import { activeObject, useSession, type ComposerVideo, type Source } from "./session";

export interface SessionWorkspace {
  modality: Modality | null;
  focus: Focus | null;
  metrics: Record<string, Measure> | null;
  primitives: Primitive[];
  source: Source;
  modelVersion: string;
  activeModel: string | null;
  composerDraft: string;
  composerAttachments: Attachment[];
  composerVideo: ComposerVideo | null;
}

/** 只持久化 modality 与 focus：刷新后恢复每个会话看的对象；结果与草稿随页面生命周期（§9.6）。 */
const STORAGE_KEY = "glaux.sessionWorkspace.v1";

type Persisted = Record<string, { modality: Modality | null; focus: Focus | null }>;

const snapshots = new Map<string, SessionWorkspace>();
let currentId: string | null = null;

function emptyWorkspace(modality: Modality | null): SessionWorkspace {
  return {
    modality,
    focus: null,
    metrics: null,
    primitives: [],
    source: "agent",
    modelVersion: "",
    activeModel: null,
    composerDraft: "",
    composerAttachments: [],
    composerVideo: null,
  };
}

function isFocus(value: unknown): value is Focus {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.object_id === "string" &&
    typeof f.kind === "string" &&
    !!f.index &&
    typeof f.index === "object" &&
    !Array.isArray(f.index)
  );
}

function readPersisted(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Persisted = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const { modality, focus } = entry as Record<string, unknown>;
      out[id] = {
        modality: typeof modality === "string" ? modality : null,
        focus: isFocus(focus) ? focus : null,
      };
    }
    return out;
  } catch {
    return {}; // 非法值或存储不可用：按空工作区处理
  }
}

function writePersisted(mutate: (all: Persisted) => void): void {
  try {
    const all = readPersisted();
    mutate(all);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* 持久化是便利项，失败不阻塞切换 */
  }
}

/** 从前台 useSession 取出当前会话的工作区字段。 */
function capture(): SessionWorkspace {
  const s = useSession.getState();
  return {
    modality: s.modality,
    focus: s.focus,
    metrics: s.metrics,
    primitives: s.primitives,
    source: s.source,
    modelVersion: s.modelVersion,
    activeModel: s.activeModel,
    composerDraft: s.composerDraft,
    composerAttachments: s.composerAttachments,
    composerVideo: s.composerVideo,
  };
}

/** 把前台状态存为该会话的快照（切走前调用）。 */
export function saveWorkspace(sessionId: string): void {
  snapshots.set(sessionId, capture());
}

/**
 * 把该会话的快照换入前台（§6.5 第 3、4 步）。没有内存快照时取持久化的 modality / focus；
 * 都没有时为空工作区并保留当前模态。焦点对象已不在对象表中则清空焦点。
 */
export async function restoreWorkspace(sessionId: string): Promise<void> {
  currentId = sessionId;
  const before = useSession.getState();
  const stored = readPersisted()[sessionId];
  const ws =
    snapshots.get(sessionId) ??
    (stored
      ? { ...emptyWorkspace(stored.modality ?? before.modality), focus: stored.focus }
      : emptyWorkspace(before.modality));
  snapshots.delete(sessionId); // 前台即真相；再次切走时重新 save

  const activeModel =
    ws.activeModel ??
    before.models.find((m) => m.active && m.modality === ws.modality)?.id ??
    null;
  useSession.setState({
    modality: ws.modality,
    focus: ws.focus,
    metrics: ws.metrics,
    primitives: ws.primitives,
    source: ws.source,
    modelVersion: ws.modelVersion,
    activeModel,
    composerDraft: ws.composerDraft,
    composerAttachments: ws.composerAttachments,
    composerVideo: ws.composerVideo,
    // SDD 04：标注随对象切走，由查看器按新焦点重新拉取
    ...(ws.focus?.object_id !== before.focus?.object_id ? { annotations: [] } : {}),
  });

  const { modality, focus } = ws;
  if (!modality || !focus) return;
  let list = useSession.getState().objects[modality];
  if (!list) {
    try {
      list = await api.objects(modality);
    } catch {
      return; // 对象表拉取失败：保留焦点，由文件栏的加载流程兜底
    }
    useSession.getState().setObjects(modality, list);
  }
  // 拉表期间用户可能已切到别的会话或换了焦点，只在仍是同一焦点时判存在性
  if (currentId !== sessionId || useSession.getState().focus !== focus) return;
  if (!activeObject(useSession.getState())) useSession.getState().setFocus(null);
}

/** 后台会话的 run_task 结果：只在其快照焦点仍是该对象时写入（§7.7 规则 7）。 */
export function writeBackgroundTaskOutput(
  sessionId: string,
  imageId: string,
  output: { metrics: Record<string, Measure> | null; primitives: Primitive[]; modelVersion: string },
): boolean {
  const ws = snapshots.get(sessionId);
  if (!ws || ws.focus?.object_id !== imageId) return false;
  snapshots.set(sessionId, { ...ws, ...output, source: "agent" });
  return true;
}

/**
 * 胶囊切换项目（SDD 13 §7.5 规则 4）：把 ``fromSessionId`` 快照里的草稿、附件、视频移到前台，
 * 原空会话的草稿随之清空。
 */
export function carryComposerFrom(fromSessionId: string): void {
  const ws = snapshots.get(fromSessionId);
  if (!ws) return;
  useSession.setState({
    composerDraft: ws.composerDraft,
    composerAttachments: ws.composerAttachments,
    composerVideo: ws.composerVideo,
  });
  snapshots.set(fromSessionId, { ...ws, composerDraft: "", composerAttachments: [], composerVideo: null });
}

/** 后台会话当前快照（测试与只读展示用）。 */
export function workspaceOf(sessionId: string): SessionWorkspace | undefined {
  return snapshots.get(sessionId);
}

/** 会话删除时清掉其快照与持久化条目。 */
export function dropWorkspace(sessionId: string): void {
  snapshots.delete(sessionId);
  if (currentId === sessionId) currentId = null;
  writePersisted((all) => {
    delete all[sessionId];
  });
}

/** 仅供测试：清空内存快照与当前会话标记。 */
export function resetWorkspacesForTest(): void {
  snapshots.clear();
  currentId = null;
}

// 前台会话的 modality / focus 变化即时持久化，刷新后可恢复（§9.6）。
useSession.subscribe((s, prev) => {
  if (!currentId || (s.focus === prev.focus && s.modality === prev.modality)) return;
  const id = currentId;
  writePersisted((all) => {
    all[id] = { modality: s.modality, focus: s.focus };
  });
});
