/**
 * 项目越界守卫（SDD 13 §7.8 规则 4、D-13）。
 *
 * 会话与项目的绑定只在 agent-runtime 可见，backend 端点保持与会话无关；因此由 runtime 在
 * 工具执行前校验：对象 `ObjectMeta.source_id` 对应数据源的 `project_id` 须等于会话的 `project_id`
 * （未归属会话要求数据源的 `project_id` 为空）。不一致时以工具错误返回模型，不调用被包装工具。
 *
 * - 只包装读取「当前对象」的工具（`PROJECT_GUARDED_TOOL_NAMES`）。`consult_atlas` 查的是全局图谱，
 *   `list_files` / `open_file` 自身经项目端点访问、越界由 backend 拒绝，均不包装。
 * - 校验对象取自查看器焦点；工具参数里显式给出的对象 id（`run_task.image_id`、
 *   `submit_video_answer.object_id`）一并校验（§15.5：收到其他项目对象的 id 时返回错误）。
 *   都没有时直接放行，由被包装工具自己处理「无焦点」。
 * - 同一 `ProjectScope` 对应一次 `start()`（一个回合），查询结果在其内缓存；失败不缓存。
 */

import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import type { HarnessTool } from "../harness-registry.js";
import { LOCATE_ROI_TOOL_NAME } from "./locate-roi.js";
import { PROPOSE_ANNOTATION_TOOL_NAME } from "./propose-annotation.js";
import { RUN_TASK_TOOL_NAME } from "./run-task.js";
import { SEGMENT_REGION_TOOL_NAME } from "./segment-region.js";
import { VIEW_CURRENT_IMAGE_TOOL_NAME } from "./view-image.js";
import { backendFailure, combinedSignal, unreachable } from "./project-backend.js";

/** 作用于「当前对象」、需在执行前做项目越界校验的工具。 */
export const PROJECT_GUARDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  RUN_TASK_TOOL_NAME,
  VIEW_CURRENT_IMAGE_TOOL_NAME,
  LOCATE_ROI_TOOL_NAME,
  SEGMENT_REGION_TOOL_NAME,
  PROPOSE_ANNOTATION_TOOL_NAME,
  "observe_video_interval",
  "submit_video_answer",
]);

/** 工具参数里可能显式携带的对象 id 字段（线上字段名 `image_id` 语义为对象 id，SDD 10 D-8）。 */
const OBJECT_ID_PARAMS = ["image_id", "object_id"] as const;

export interface ProjectScopeOptions {
  /** 会话绑定的项目；缺省为未归属。 */
  projectId?: string;
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class ProjectScope {
  readonly projectId: string | null;
  private readonly viewer: ViewerContext;
  private readonly base: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly sourceOf = new Map<string, Promise<string>>();
  private projectOfSource: Promise<Map<string, string | null>> | undefined;

  constructor(options: ProjectScopeOptions = {}) {
    this.projectId = options.projectId ?? null;
    this.viewer = options.viewer ?? {};
    this.base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
    this.doFetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** 本次调用会作用到的对象：查看器焦点 + 参数里显式给出的对象 id。 */
  targets(params: unknown): string[] {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string" && value.trim()) ids.add(value.trim());
    };
    add(this.viewer.focus?.object_id);
    add(this.viewer.object?.id);
    if (params && typeof params === "object") {
      for (const key of OBJECT_ID_PARAMS) add((params as Record<string, unknown>)[key]);
    }
    return [...ids];
  }

  /** 对象不属于会话项目时抛出工具错误。 */
  async assertInProject(objectId: string, signal?: AbortSignal): Promise<void> {
    const sourceId = await this.cached(this.sourceOf, objectId, () => this.fetchSourceId(objectId, signal));
    const projects = await this.datasourceProjects(signal);
    if (!projects.has(sourceId)) {
      throw new Error(
        `Cannot verify that object ${objectId} belongs to this conversation's project: its data source ${sourceId} is not registered.`,
      );
    }
    const owner = projects.get(sourceId) ?? null;
    if (owner === this.projectId) return;
    const here = this.projectId ? `project ${this.projectId}` : "no project (unassigned conversation)";
    const there = owner ? `project ${owner}` : "no project";
    throw new Error(
      `Object ${objectId} does not belong to this conversation's project: the conversation is bound to ${here}, ` +
        `but the object belongs to ${there}. Tools here only act on objects inside the conversation's project; ` +
        "the call was not executed. Ask the user to open an object from this project.",
    );
  }

  private async cached<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
    let pending = cache.get(key);
    if (!pending) {
      pending = load();
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    return pending;
  }

  private async fetchSourceId(objectId: string, signal?: AbortSignal): Promise<string> {
    const action = `Project check for object ${objectId}`;
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}/objects/${encodeURIComponent(objectId)}`, {
        signal: combinedSignal(this.timeoutMs, signal),
      });
    } catch (error) {
      throw unreachable(action, error);
    }
    if (!response.ok) throw await backendFailure(response, action);
    const meta = (await response.json()) as { source_id?: unknown };
    if (typeof meta.source_id !== "string" || !meta.source_id) {
      throw new Error(`${action} failed: the backend returned no source_id.`);
    }
    return meta.source_id;
  }

  private datasourceProjects(signal?: AbortSignal): Promise<Map<string, string | null>> {
    if (!this.projectOfSource) {
      const pending = (async () => {
        const action = "Project check (listing data sources)";
        let response: Response;
        try {
          response = await this.doFetch(`${this.base}/datasources`, { signal: combinedSignal(this.timeoutMs, signal) });
        } catch (error) {
          throw unreachable(action, error);
        }
        if (!response.ok) throw await backendFailure(response, action);
        const sources = (await response.json()) as { id?: unknown; project_id?: unknown }[];
        return new Map(
          (Array.isArray(sources) ? sources : [])
            .filter((source): source is { id: string; project_id?: unknown } => typeof source?.id === "string")
            .map((source) => [source.id, typeof source.project_id === "string" && source.project_id ? source.project_id : null]),
        );
      })();
      this.projectOfSource = pending;
      pending.catch(() => {
        if (this.projectOfSource === pending) this.projectOfSource = undefined;
      });
    }
    return this.projectOfSource;
  }
}

/** 在被包装工具执行前做越界校验；越界或无法校验时抛出工具错误，不调用被包装工具。 */
export function withProjectGuard(tool: HarnessTool, scope: ProjectScope): HarnessTool {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, context) {
      for (const objectId of scope.targets(params)) await scope.assertInProject(objectId, signal);
      return tool.execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}
