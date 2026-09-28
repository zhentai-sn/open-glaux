// 真实数据编排——三个动作（SDD 10 §6.2 / §6.3）：
//   loadObjects(modality) 载某模态的对象表；openObject(id) 设唯一焦点；runTask(region?) 跑当前对象的任务。
// 模态差异一律经 ObjectMeta.kind / TaskView（trigger、object_kinds）表达，本文件不按模态分支（D-14）。
// 不推送智能体发言（静默载入）；智能体对话走 agent-runtime 会话（store/agentSessions）。
import { api } from "../api/client";
import type { Index, Modality, ObjectMeta, Region, TaskSpec, TaskView, UploadResult } from "../api/types";
import { getT } from "../i18n";
import { useAgentSessions } from "../store/agentSessions";
import { activeObject, TOOL_OPTIONS_DEFAULTS, useSession } from "../store/session";
import { pushRecent, pruneRecent } from "./recent";

type State = ReturnType<typeof useSession.getState>;

/** 对象所属模态下、接受其几何族的 TaskView；无任务的模态（natural_image、video）为 undefined。 */
export function taskViewFor(s: Pick<State, "tasks">, obj: ObjectMeta | null): TaskView | undefined {
  if (!obj) return undefined;
  return s.tasks.find((t) => t.modality === obj.modality && t.object_kinds.includes(obj.kind));
}

/** 当前焦点对象的 TaskView（无焦点时退回当前模态的首个任务行，供工具栏 / 度量面板取字段）。 */
export function currentTaskView(s: Pick<State, "tasks" | "objects" | "modality" | "focus">): TaskView | undefined {
  const obj = activeObject(s);
  if (obj) return taskViewFor(s, obj);
  return s.tasks.find((t) => t.modality === s.modality);
}

/** 打开对象时的缺省索引，由 axes 决定：z / t 取 0，level 取最粗层（§11.1）。 */
export function defaultIndex(obj: ObjectMeta): Index {
  const out: Index = {};
  for (const a of obj.axes) {
    if (a.name === "z" || a.name === "t") out[a.name] = 0;
    if (a.name === "level") out.level = a.size - 1;
  }
  return out;
}

function findObject(s: State, id: string): ObjectMeta | null {
  for (const list of Object.values(s.objects)) {
    const hit = list.find((o) => o.id === id);
    if (hit) return hit;
  }
  return null;
}

/** 记一条最近使用（SDD 08 §9.4、SDD 10 §9.5）。 */
function noteRecent(obj: ObjectMeta): void {
  const s = useSession.getState();
  s.setRecentItems(
    pushRecent(s.recentItems, {
      modality: obj.modality,
      kind: obj.kind,
      id: obj.id,
      label: obj.display_name || obj.id,
      at: new Date().toISOString(),
    }),
  );
}

/** 剔除已不存在的最近项——某模态**已加载**的列表里没有该 id 才剔除；未加载的模态一律保留。 */
export function prunedRecent() {
  const s = useSession.getState();
  const next = pruneRecent(s.recentItems, (m, id) => {
    const list = s.objects[m];
    if (!list) return true; // 缺键 = 尚未加载，不是「不存在」
    return list.some((o) => o.id === id);
  });
  if (next.length !== s.recentItems.length) s.setRecentItems(next);
  return next;
}

/** 清空叠加/度量态（切对象/切模态时）。 */
function clearOverlays(): void {
  const s = useSession.getState();
  s.setMetrics(null);
  s.setPrimitives([]);
  s.setSource("agent");
  s.setModelVersion("");
  s.setAnnotations([]); // SDD 04：标注随对象切走，由查看器重新拉取
}

/**
 * 进入一个模态：焦点置空、清叠加、工具与工具参数复位、活动模型跟随模态（§11.1 切模态即清空）。
 * 新模态没有活动模型时置 null，不沿用上一模态的（W0 F-1）。
 */
function enterModality(modality: Modality): void {
  const s = useSession.getState();
  s.setModality(modality);
  s.setFocus(null);
  clearOverlays();
  s.setTool("cursor");
  s.setToolOptions({
    brush: { ...TOOL_OPTIONS_DEFAULTS.brush },
    voi: { ...TOOL_OPTIONS_DEFAULTS.voi },
  });
  const pick = s.models.find((m) => m.modality === modality && m.active);
  useSession.setState({ activeModel: pick?.id ?? null });
}

/**
 * 载入某模态的对象表。切到新模态时先复位（enterModality）；同一模态则只刷新列表、保留仍存在的焦点。
 * 无焦点时打开 ``open`` 指定的对象，缺省打开首个对象。
 */
export async function loadObjects(modality: Modality, opts: { open?: string } = {}): Promise<void> {
  if (useSession.getState().modality !== modality) enterModality(modality);
  const list = await api.objects(modality);
  const s = useSession.getState();
  s.setObjects(modality, list);
  const target = opts.open ?? s.focus?.object_id;
  if (target && list.some((o) => o.id === target)) {
    if (target !== s.focus?.object_id) await openObject(target);
    return;
  }
  // 自动打开首个对象是装配动作，不是用户打开对象：保留刷新后刚恢复的文档视图（SDD 14 §7.5）
  if (list.length) await openObject(list[0].id, undefined, { keepDocument: true });
  else s.setFocus(null);
}

/**
 * 打开一个对象（SDD 10 §6.2）：设焦点（缺省索引、无选区）、清叠加，按 TaskView.trigger 决定是否自动跑。
 * 无 TaskView 的模态即 manual（D-18 显式 no-task 契约）。对象所属模态尚未加载时给出 ``modality``。
 * ``keepDocument`` 只供装配路径使用：设焦点但不关闭文档视图。
 */
export async function openObject(
  id: string,
  modality?: Modality,
  opts: { keepDocument?: boolean } = {},
): Promise<void> {
  let s = useSession.getState();
  let obj = findObject(s, id);
  if (!obj && modality) {
    s.setObjects(modality, await api.objects(modality));
    s = useSession.getState();
    obj = findObject(s, id);
  }
  if (!obj) return;
  if (obj.modality !== s.modality) enterModality(obj.modality);
  noteRecent(obj);
  // SDD 14 §7.3 规则 8：打开视觉对象即关闭文档视图。setFocus 只在焦点对象变化时清空 document，
  // 重新打开当前焦点对象（文档覆盖在它之上时）由这里补上。
  const keep = opts.keepDocument ? useSession.getState().document : null;
  useSession.getState().setDocument(null);
  useSession.getState().setFocus({ object_id: id, kind: obj.kind, index: defaultIndex(obj), region: null });
  if (keep) useSession.getState().setDocument(keep);
  clearOverlays();
  const trigger = taskViewFor(useSession.getState(), obj)?.trigger ?? "manual";
  if (trigger === "on_open") await runTask();
}

/**
 * 跑当前对象的任务（SDD 10 §6.3）。入参来源固定：image_id ← focus.object_id；calibration ←
 * 对象标定（null 不下发）；region ← 实参 ?? focus.region；method ← activeModel。成功返回 true。
 * ``on_region`` 任务在没有选区时不发请求。
 */
export async function runTask(region?: Region): Promise<boolean> {
  const s = useSession.getState();
  const obj = activeObject(s);
  const tv = taskViewFor(s, obj);
  if (!obj || !tv) return false;
  if (region) s.setRegion(region);
  const r = region ?? s.focus?.region ?? null;
  if (tv.trigger === "on_region" && !r) return false;
  const spec: TaskSpec = { task: tv.task, image_id: obj.id };
  if (obj.calibration) spec.calibration = obj.calibration;
  if (r) spec.region = r;
  const method = s.activeModel || undefined;
  if (method) spec.method = method;
  s.setLoading(true);
  try {
    const res = await api.taskRun(spec);
    const now = useSession.getState();
    if (now.focus?.object_id !== obj.id) return false; // 结果回来前已切走：丢弃，不串到新对象
    now.setMetrics(res.metrics);
    now.setPrimitives(res.primitives);
    now.setSource("agent");
    now.setModelVersion(String(res.provenance.model_version ?? method ?? ""));
    return Object.keys(res.metrics).length > 0;
  } catch {
    clearOverlays();
    return false;
  } finally {
    useSession.getState().setLoading(false);
  }
}

/**
 * 拉数据源清单并设加载态（SDD 08 §7 规则 1/4、§11）。
 * 失败置 `failed` 而**不是**空数组——把请求失败画成空态卡，会让用户以为自己没数据而去重新导入。
 */
export async function refreshDataSources(): Promise<void> {
  const s = useSession.getState();
  try {
    s.setDatasources(await api.datasources());
    s.setDsState("ready");
  } catch {
    s.setDsState("failed");
  }
}

/** 当前有活动数据源的模态集合——模态切换器的可见性与「要不要拉数据」都读它。 */
export function activeModalities(): Modality[] {
  const seen = new Set<Modality>();
  for (const d of useSession.getState().datasources) {
    if (d.status === "active") seen.add(d.modality);
  }
  return [...seen];
}

/** 启动与数据源变更后的装配：当前模态仍有数据则刷新，否则进入首个有数据的模态。 */
export async function loadInitialObjects(): Promise<void> {
  const mods = activeModalities();
  if (!mods.length) return;
  const cur = useSession.getState().modality;
  await loadObjects(cur && mods.includes(cur) ? cur : mods[0]);
}

// ---- 项目作用域（SDD 13 §7.8） ----

/** 当前会话所属项目；未归属为 null。 */
export function currentProjectId(): string | null {
  const a = useAgentSessions.getState();
  return a.sessions.find((s) => s.session_id === a.currentSessionId)?.project_id ?? null;
}

/** 对象所属项目：经其数据源的 project_id 判定；数据源未知时为 undefined。 */
export function projectOfObject(obj: Pick<ObjectMeta, "source_id">): string | null | undefined {
  const ds = useSession.getState().datasources.find((d) => d.id === obj.source_id);
  return ds ? (ds.project_id ?? null) : undefined;
}

let openSeq = 0; // 连点守卫：只有最后一次 openProjectFile 设焦点

/**
 * 按路径打开项目内文件（SDD 13 §6.3）：后端校验并按需登记数据源 → 数据源是新登记的才刷新数据源 →
 * 把返回的对象并入该模态对象表（对象表未加载时才整表拉取）→ 走 openObject 设焦点。
 * 连续点击时只有最后一次设焦点。失败抛 ApiError（code 为 outside_project / unsupported_format / corrupt 等）。
 */
export async function openProjectFile(projectId: string, path: string): Promise<ObjectMeta> {
  const seq = ++openSeq;
  const meta = await api.openProjectObject(projectId, path);
  if (!useSession.getState().datasources.some((d) => d.id === meta.source_id)) await refreshDataSources();
  const loaded = useSession.getState().objects[meta.modality];
  const base = loaded ?? (await api.objects(meta.modality));
  const list = useSession.getState().objects[meta.modality] ?? base; // 拉表期间可能已被别处写入
  const at = list.findIndex((o) => o.id === meta.id);
  useSession
    .getState()
    .setObjects(meta.modality, at < 0 ? [...list, meta] : list.map((o, i) => (i === at ? meta : o)));
  if (seq === openSeq) await openObject(meta.id);
  return meta;
}

/**
 * 在舞台预览项目内文本文件（SDD 14 §6.1）：只写会话级 document，不改 focus；正文由 DocumentView 按
 * 当前会话的项目请求。同一文件正在加载时不重复发起（§10）；已加载时重新打开即重新读取（§13）。
 */
export function openProjectDocument(path: string): void {
  const s = useSession.getState();
  if (s.document?.path === path && s.documentLoading) return;
  useSession.setState({ document: { path }, documentError: null });
}

/** 关闭文档视图，舞台回到 focus 对象或占位（SDD 14 §11.1）。 */
export function closeDocument(): void {
  useSession.getState().setDocument(null);
}

/** 上传一批本地文件 → 刷新数据源 → 进入其模态并打开首个受理的对象。返回结果供 UI 列出被拒项。 */
export async function uploadImages(files: File[]): Promise<UploadResult> {
  const result = await api.uploadImages(files, undefined, currentProjectId());
  await refreshDataSources();
  const first = result.accepted[0];
  if (first) await loadObjects(result.source.modality, { open: first.id });
  return result;
}

/** 显式加载示例数据源 → 刷新清单；若此前空态则加载首个可用模态的数据。返回加载到的源数。 */
export async function loadSamples(): Promise<number> {
  const added = await api.loadSamples();
  await refreshDataSources();
  if (added.length) await loadInitialObjects();
  return added.length;
}

/** 刷新「插件市场」相关注册表（能力 + 数据源 + 模型）——导入/删除数据源后调。 */
export async function reloadMarket(): Promise<void> {
  const [caps, ds, models] = await Promise.all([
    api.capabilities(),
    api.datasources(),
    api.models(),
  ]);
  useSession.getState().setCapabilities(caps);
  useSession.getState().setDatasources(ds);
  useSession.getState().setModels(models);
}

/** 删除一个导入源 → 刷新市场与对象表（防删掉正用的源后列表悬空）。 */
export async function removeDataSource(id: string): Promise<void> {
  await api.removeDatasource(id);
  await reloadMarket();
  useSession.getState().setDsState("ready");
  // 删到一个 active 源都不剩 → 回空态，不再去拉必然为空的对象表（§7 规则 4）
  if (!activeModalities().length) {
    useSession.setState({ objects: {} });
    useSession.getState().setFocus(null);
    return;
  }
  await loadInitialObjects();
}

/** 重跑当前对象的任务（切模型 / 「重新运行」动作用）；on_region 任务无选区时为空操作。 */
export async function reRunActiveModel(): Promise<void> {
  await runTask();
}

/**
 * 「复现验证」动作（SDD 04 §7.5 规则 7）：结果写 store `verification`，由读数条呈现；
 * 结果回来前已切走对象则丢弃。不可用时提示并清空结果。
 */
export async function verifyActiveObject(): Promise<void> {
  const obj = activeObject(useSession.getState());
  if (!obj) return;
  try {
    const r = await api.wsiVerify(obj.id);
    const now = useSession.getState();
    if (now.focus?.object_id !== obj.id) return;
    now.setVerification({ f1: r.f1, count_pred: r.count_pred, count_ref: r.count_ref });
  } catch {
    const now = useSession.getState();
    if (now.focus?.object_id !== obj.id) return;
    now.setVerification(null);
    now.notify("crit", getT()("wsi_verify_unavailable"));
  }
}
