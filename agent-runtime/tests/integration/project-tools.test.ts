/**
 * SDD 13 §7.3、§7.8 规则 4：项目浏览工具与越界守卫。
 *
 * 覆盖：挂载条件（有无项目、observe 模式、视觉门控）、`start()` 从 Pi metadata 读出项目、
 * `list_files` 截断语义、`open_file` 取帧与对象卡片 details、后端 422 以工具错误返回且回合继续、
 * 越界对象被拦且未调用被包装工具的后端端点、项目内放行、未归属会话拦项目对象、回合内缓存。
 *
 * 项目内文本读取由 SDD 16 的 `read` 承担，见 files-tools.test.ts。
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionInput, TransportEvent } from "../../src/contracts.js";
import { defaultToolFactory, type HarnessToolContext } from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import {
  createListFilesTool,
  FILES_LISTED_DETAILS_KIND,
  LIST_FILES_TOOL_NAME,
  type FilesListedDetails,
} from "../../src/pi/tools/list-files.js";
import {
  createOpenFileTool,
  OBJECT_OPENED_DETAILS_KIND,
  OPEN_FILE_TOOL_NAME,
  type ObjectOpenedDetails,
} from "../../src/pi/tools/open-file.js";
import { ProjectScope } from "../../src/pi/tools/project-guard.js";
import { permissionPlugin } from "../../src/permission/plugin.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { pluginTools } from "../../src/plugins/registry.js";
import type { HarnessTool } from "../../src/pi/harness-registry.js";
import { createRunTaskTool, RUN_TASK_TOOL_NAME } from "../../src/pi/tools/run-task.js";
import { createViewCurrentImageTool, VIEW_CURRENT_IMAGE_TOOL_NAME } from "../../src/pi/tools/view-image.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";
import { objectFrameStub, viewerOn } from "../helpers/viewer-fixture.js";

const BASE = "http://backend.test";
const HOSTED = { provider: "openai-compatible", base_url: "https://api.example.com/v1" };
const runtime = undefined as unknown as ModelRuntime;

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 注入式 fetch：记录每次请求，按 handler 顺序应答，未命中 404。 */
function fakeBackend(...handlers: Handler[]) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const handler of handlers) {
      const response = handler(url, init);
      if (response) return response;
    }
    return json({ detail: "not found" }, 404);
  }) as unknown as typeof fetch;
  const paths = () => calls.map((call) => call.url.pathname);
  return { fetch: fetchImpl, calls, paths };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

function names(context: HarnessToolContext): string[] {
  return defaultToolFactory(context).map((tool) => tool.name);
}

describe("浏览工具挂载条件（SDD 13 §7.3 规则 1）", () => {
  const vision = { ...HOSTED, vision: true } as ConnectionInput;

  it("绑定项目的会话挂载 list_files 与 open_file", () => {
    expect(names({ permissionMode: "controlled", connection: vision, runtime, projectId: "prj-a" }))
      .toEqual(expect.arrayContaining([LIST_FILES_TOOL_NAME, OPEN_FILE_TOOL_NAME]));
  });

  it("未归属会话不挂载", () => {
    const mounted = names({ permissionMode: "controlled", connection: vision, runtime });
    expect(mounted).not.toContain(LIST_FILES_TOOL_NAME);
    expect(mounted).not.toContain(OPEN_FILE_TOOL_NAME);
  });

  it("observe 模式只挂只读工具，浏览工具仍可用（SDD 15 D-10）", () => {
    expect(names({ permissionMode: "observe", connection: vision, runtime, projectId: "prj-a" }))
      .toEqual(expect.arrayContaining([LIST_FILES_TOOL_NAME, OPEN_FILE_TOOL_NAME]));
  });

  it("无视觉的连接只挂 list_files", () => {
    const mounted = names({
      permissionMode: "controlled",
      connection: { ...HOSTED, vision: false } as ConnectionInput,
      runtime,
      projectId: "prj-a",
    });
    expect(mounted).toContain(LIST_FILES_TOOL_NAME);
    expect(mounted).not.toContain(OPEN_FILE_TOOL_NAME);
  });

  it("越界判定只针对作用于当前对象的工具", () => {
    expect(pluginTools().filter((tool) => tool.projectScoped).map((tool) => tool.name).sort()).toEqual([
      "list_annotations", "locate_roi", "observe_video_interval", "propose_annotation", "revise_annotation", "run_task",
      "segment_region", "submit_video_answer", "view_current_image",
    ]);
  });
});

describe("list_files", () => {
  it("说明提示可用 read 读取候选模态为 - 的文件（SDD 16 §7.3）", () => {
    const tool = createListFilesTool({ projectId: "prj-a", backendBaseUrl: BASE });
    expect(tool.description).toMatch(/candidate modality "-" may be text.*read./su);
  });

  const entries = (n: number) => Array.from({ length: n }, (_, i) => ({
    name: `img_${i}.jpg`, path: `cases/img_${i}.jpg`, type: "file" as const, modality: "image", object_id: i === 0 ? "obj-0" : null,
  }));

  it("超过 200 条时截断并报出总数", async () => {
    const backend = fakeBackend((url) =>
      url.pathname === "/projects/prj-a/entries" ? json({ path: "cases", entries: entries(250), total: 250 }) : undefined);
    const tool = createListFilesTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });

    const result = await tool.execute("c1", { path: "cases" }, undefined, undefined, undefined);
    const details = result.details as FilesListedDetails;

    expect(backend.calls[0]?.url.searchParams.get("path")).toBe("cases");
    expect(details).toMatchObject({ kind: FILES_LISTED_DETAILS_KIND, path: "cases", total: 250 });
    expect(details.entries).toHaveLength(200);
    const text = textOf(result);
    expect(text).toContain("250");
    expect(text).toMatch(/first 200 of 250/u);
    expect(text).toContain("cases/img_0.jpg\timage\topened as obj-0");
    expect(text).toContain("cases/img_1.jpg\timage\tnot opened");
    expect(text).not.toContain("img_200.jpg");
  });

  it("缺省列根目录，不带 path 参数", async () => {
    const backend = fakeBackend((url) =>
      url.pathname === "/projects/prj-a/entries"
        ? json({ path: "", entries: [{ name: "cases", path: "cases", type: "dir", modality: null, object_id: null }], total: 1 })
        : undefined);
    const tool = createListFilesTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    const result = await tool.execute("c1", {}, undefined, undefined, undefined);
    expect(backend.calls[0]?.url.searchParams.has("path")).toBe(false);
    expect(textOf(result)).toContain("dir\tcases/");
    expect(textOf(result)).not.toMatch(/Only the first/u);
  });

  it("越界路径以带错误码的工具错误返回", async () => {
    const backend = fakeBackend(() => json({ detail: { code: "outside_project", message: "路径越出项目根" } }, 422));
    const tool = createListFilesTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    await expect(tool.execute("c1", { path: "../x" }, undefined, undefined, undefined)).rejects.toThrow(/HTTP 422, code outside_project/u);
  });
});

const IMAGE_META = {
  id: "prj-img-1", kind: "image", modality: "image", source_id: "src-a", display_name: "scan_01.jpg",
  axes: [{ name: "x", size: 64 }, { name: "y", size: 48 }], calibration: null,
  resources: { frame: "/objects/prj-img-1/frame" }, streams: [], methods: [], meta: {},
};

const VIDEO_META = {
  id: "vid-prj-1", kind: "video", modality: "video", source_id: "src-v", display_name: "clip.mp4",
  axes: [{ name: "x", size: 64 }, { name: "y", size: 48 }, { name: "t", size: 300, spacing: 40, unit: "ms" }],
  calibration: null, resources: { frame: "/objects/vid-prj-1/frame" }, streams: [{ kind: "audio" }], methods: [], meta: {},
};

describe("open_file", () => {
  it("打开图像：返回首帧图像块与对象卡片 details", async () => {
    const backend = fakeBackend(
      (url, init) => url.pathname === "/projects/prj-a/objects" && init?.method === "POST" ? json(IMAGE_META) : undefined,
      (url) => objectFrameStub(url.href),
    );
    const tool = createOpenFileTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });

    const result = await tool.execute("c1", { path: "cases/scan_01.jpg" }, undefined, undefined, undefined);

    expect(backend.calls[0]?.body).toEqual({ path: "cases/scan_01.jpg" });
    // image 空索引：取帧不带 z / t / level
    expect(backend.calls[1]?.url.pathname).toBe("/objects/prj-img-1/frame");
    expect([...backend.calls[1]!.url.searchParams.keys()]).toEqual([]);
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(1);
    const text = textOf(result);
    expect(text).toContain("prj-img-1");
    expect(text).toContain("modality image");
    expect(text).toContain("64×48 px");
    expect(text).toMatch(/stage is unchanged/u);
    expect(result.details as ObjectOpenedDetails).toEqual({
      kind: OBJECT_OPENED_DETAILS_KIND,
      path: "cases/scan_01.jpg",
      object: {
        id: "prj-img-1", kind: "image", modality: "image", source_id: "src-a", display_name: "scan_01.jpg",
        axes: IMAGE_META.axes,
      },
    });
  });

  it("打开视频：按 t=0 取帧，摘要带时长与音轨", async () => {
    const backend = fakeBackend(
      (url) => url.pathname === "/projects/prj-a/objects" ? json(VIDEO_META) : undefined,
      (url) => objectFrameStub(url.href),
    );
    const tool = createOpenFileTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    const result = await tool.execute("c1", { path: "clip.mp4" }, undefined, undefined, undefined);
    expect(backend.calls[1]?.url.searchParams.get("t")).toBe("0");
    const text = textOf(result);
    expect(text).toContain("duration ≈ 12 s");
    expect(text).toContain("has an audio track");
    expect(text).toContain("at t=0");
  });

  it("后端 422 以带 code 的工具错误返回", async () => {
    const backend = fakeBackend(() =>
      json({ detail: { code: "unsupported_format", message: "CT 将在 P2 支持" } }, 422));
    const tool = createOpenFileTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    await expect(tool.execute("c1", { path: "ct/volume.nii.gz" }, undefined, undefined, undefined))
      .rejects.toThrow(/open_file failed \(HTTP 422, code unsupported_format\): CT 将在 P2 支持/u);
    // 未取帧
    expect(backend.paths()).toEqual(["/projects/prj-a/objects"]);
  });

  it("FastAPI 字符串 detail 里的错误码也能识别", async () => {
    const backend = fakeBackend(() => json({ detail: "corrupt: 魔数与后缀不符" }, 422));
    const tool = createOpenFileTool({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    await expect(tool.execute("c1", { path: "a.jpg" }, undefined, undefined, undefined)).rejects.toThrow(/code corrupt/u);
  });
});

describe("open_file 经 harness（SDD 13 §7.3 规则 6、§15.2）", () => {
  it("项目取自 Pi metadata；422 作为工具错误返回模型，回合继续", async () => {
    const backend = fakeBackend(() => json({ detail: { code: "outside_project", message: "越界" } }, 422));
    const seen: HarnessToolContext[] = [];
    const fixture = await createRuntimeFixture(
      [
        [
          fauxAssistantMessage(fauxToolCall(OPEN_FILE_TOOL_NAME, { path: "../secret.jpg" }), { stopReason: "toolUse" }),
          fauxAssistantMessage("That path is outside the project."),
        ],
        [fauxAssistantMessage("hello")],
      ],
      {
        toolFactory: (context) => {
          seen.push(context);
          return context.projectId
            ? [createOpenFileTool({ projectId: context.projectId, fetch: backend.fetch, backendBaseUrl: BASE })]
            : [];
        },
      },
    );
    const projectSession = crypto.randomUUID();
    const plainSession = crypto.randomUUID();
    const events: TransportEvent[] = [];
    try {
      await fixture.sessions.createSession({ session_id: projectSession, project_id: "prj-a" });
      fixture.registry.subscribe(projectSession, (event) => events.push(event));
      await fixture.commands.accept(projectSession, {
        command_id: crypto.randomUUID(), type: "prompt", content: "open it", connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(projectSession);
      const isToolEnd = (e: TransportEvent) => e.event === "tool.end";
      await waitFor(() => events.some(isToolEnd));

      expect(seen[0]?.projectId).toBe("prj-a");
      expect(backend.paths()).toEqual(["/projects/prj-a/objects"]);
      const toolEnd = (events.find(isToolEnd) as Extract<TransportEvent, { event: "tool.end" }>).data;
      expect(toolEnd.is_error).toBe(true);
      expect(toolEnd.error_text).toContain("outside_project");
      const view = await fixture.sessions.getSession(projectSession);
      const last = view.messages.at(-1) as { role?: string; content?: unknown };
      expect(last.role).toBe("assistant");
      expect(JSON.stringify(last.content)).toContain("outside the project");

      // 未归属会话：toolContext 不带 projectId
      await fixture.sessions.createSession({ session_id: plainSession });
      await fixture.commands.accept(plainSession, {
        command_id: crypto.randomUUID(), type: "prompt", content: "hi", connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(plainSession);
      expect(seen[1]).toBeDefined();
      expect(seen[1]!.projectId).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });
});

/** 对象 → 数据源 → 项目 的桩；另记录 `/task/run` 调用。 */
function scopedBackend(objects: Record<string, string>, sources: Record<string, string | null>) {
  return fakeBackend(
    (url) => {
      const match = /^\/objects\/([^/]+)$/u.exec(url.pathname);
      if (!match) return undefined;
      const sourceId = objects[decodeURIComponent(match[1]!)];
      return sourceId ? json({ id: match[1], source_id: sourceId }) : json({ detail: "对象不存在" }, 404);
    },
    (url) => url.pathname === "/datasources"
      ? json(Object.entries(sources).map(([id, project_id]) => ({ id, project_id })))
      : undefined,
    (url) => url.pathname === "/task/run"
      ? json({ task: "t", metrics: {}, primitives: [], provenance: {} })
      : undefined,
    (url) => objectFrameStub(url.href),
  );
}

/** 先经权限插件的 tool_call 钩子判定越界（SDD 15 §7.5 第 1 步），放行后再执行工具。 */
function guarded(tool: HarnessTool, scope: ProjectScope): HarnessTool {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, context) {
      const verdict = await permissionPlugin.hooks!.tool_call!(
        { type: "tool_call", toolCallId, toolName: tool.name, input: params as Record<string, unknown> },
        {
          sessionId: "s",
          commandId: "c",
          permission: {
            getMode: () => "controlled",
            tools: new Map(pluginTools().map((t) => [t.name, t])),
            scope,
            settings: EMPTY_SETTINGS,
            grants: new Set(),
            audit: async () => undefined,
            alwaysPath: "",
          },
        },
      );
      if (verdict?.block) throw new Error(verdict.reason);
      return tool.execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}

function guardedRunTask(backend: ReturnType<typeof fakeBackend>, scope: ProjectScope, objectId?: string) {
  const viewer = objectId ? viewerOn(objectId, { task: "fetal_hc" }) : undefined;
  return guarded(createRunTaskTool({ fetch: backend.fetch, backendBaseUrl: BASE, ...(viewer ? { viewer } : {}) }) as never, scope);
}


describe("项目越界守卫（SDD 13 §7.8 规则 4）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("其他项目的对象被拦截，未调用任务端点", async () => {
    const backend = scopedBackend({ tech_0450: "src-b" }, { "src-a": "prj-a", "src-b": "prj-b" });
    const scope = new ProjectScope({ projectId: "prj-a", viewer: viewerOn("tech_0450"), fetch: backend.fetch, backendBaseUrl: BASE });
    const tool = guardedRunTask(backend, scope, "tech_0450");

    await expect(tool.execute("c1", {}, undefined, undefined, undefined))
      .rejects.toThrow(/does not belong to this conversation's project.*project prj-a.*project prj-b/su);
    expect(backend.paths()).not.toContain("/task/run");
  });

  it("项目内对象放行", async () => {
    const backend = scopedBackend({ tech_0450: "src-a" }, { "src-a": "prj-a" });
    const scope = new ProjectScope({ projectId: "prj-a", viewer: viewerOn("tech_0450"), fetch: backend.fetch, backendBaseUrl: BASE });
    await guardedRunTask(backend, scope, "tech_0450").execute("c1", {}, undefined, undefined, undefined);
    expect(backend.paths()).toEqual(["/objects/tech_0450", "/datasources", "/task/run"]);
  });

  it("未归属会话拦截项目源对象，放行未归属源对象", async () => {
    const backend = scopedBackend({ tech_0450: "src-a", tech_0451: "src-free" }, { "src-a": "prj-a", "src-free": null });

    const blocked = new ProjectScope({ viewer: viewerOn("tech_0450"), fetch: backend.fetch, backendBaseUrl: BASE });
    await expect(guardedRunTask(backend, blocked, "tech_0450").execute("c1", {}, undefined, undefined, undefined))
      .rejects.toThrow(/no project \(unassigned conversation\).*project prj-a/su);

    const allowed = new ProjectScope({ viewer: viewerOn("tech_0451"), fetch: backend.fetch, backendBaseUrl: BASE });
    await guardedRunTask(backend, allowed, "tech_0451").execute("c1", {}, undefined, undefined, undefined);
    expect(backend.paths().filter((path) => path === "/task/run")).toHaveLength(1);
  });

  it("参数里显式给出的其他项目对象 id 也被拦截", async () => {
    const backend = scopedBackend({ tech_0450: "src-a", tech_0999: "src-b" }, { "src-a": "prj-a", "src-b": "prj-b" });
    const scope = new ProjectScope({ projectId: "prj-a", viewer: viewerOn("tech_0450"), fetch: backend.fetch, backendBaseUrl: BASE });
    await expect(guardedRunTask(backend, scope, "tech_0450").execute("c1", { image_id: "tech_0999" }, undefined, undefined, undefined))
      .rejects.toThrow(/Object tech_0999 does not belong/u);
    expect(backend.paths()).not.toContain("/task/run");
  });

  it("同一回合两次调用只查询一次", async () => {
    const backend = scopedBackend({ tech_0450: "src-a" }, { "src-a": "prj-a" });
    const scope = new ProjectScope({ projectId: "prj-a", viewer: viewerOn("tech_0450"), fetch: backend.fetch, backendBaseUrl: BASE });
    const runTask = guardedRunTask(backend, scope, "tech_0450");
    const view = guarded(
      createViewCurrentImageTool({ fetch: backend.fetch, backendBaseUrl: BASE, viewer: viewerOn("tech_0450") }) as never,
      scope,
    );
    await runTask.execute("c1", {}, undefined, undefined, undefined);
    await view.execute("c2", {}, undefined, undefined, undefined);
    await runTask.execute("c3", {}, undefined, undefined, undefined);
    expect(backend.paths().filter((path) => path === "/datasources")).toHaveLength(1);
    expect(backend.paths().filter((path) => path === "/objects/tech_0450")).toHaveLength(1);
  });

  it("没有焦点时直接交给被包装工具", async () => {
    const backend = scopedBackend({}, {});
    const scope = new ProjectScope({ projectId: "prj-a", fetch: backend.fetch, backendBaseUrl: BASE });
    const view = guarded(createViewCurrentImageTool({ fetch: backend.fetch, backendBaseUrl: BASE }) as never, scope);
    const result = await view.execute("c1", {}, undefined, undefined, undefined);
    expect(textOf(result)).toMatch(/No image is open/u);
    expect(backend.calls).toEqual([]);
  });

  it("后端不可达时返回工具错误，不调用被包装工具", async () => {
    const calls: string[] = [];
    const down = (async (input: string | URL | Request) => {
      calls.push(String(input));
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const scope = new ProjectScope({ projectId: "prj-a", viewer: viewerOn("tech_0450"), fetch: down, backendBaseUrl: BASE });
    const tool = guarded(
      createRunTaskTool({ fetch: down, backendBaseUrl: BASE, viewer: viewerOn("tech_0450", { task: "fetal_hc" }) }) as never,
      scope,
    );
    await expect(tool.execute("c1", {}, undefined, undefined, undefined)).rejects.toThrow(/backend is unreachable/u);
    expect(calls.some((url) => url.endsWith("/task/run"))).toBe(false);
  });

  it("经 harness 运行时，越界的 run_task 被权限插件拦截，判定依据记为越界", async () => {
    const backend = scopedBackend({ tech_0450: "src-b" }, { "src-b": "prj-b" });
    const fixture = await createRuntimeFixture(
      [[
        fauxAssistantMessage(fauxToolCall(RUN_TASK_TOOL_NAME, {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("blocked"),
      ]],
      {
        toolFactory: ({ viewer }) => [createRunTaskTool({ fetch: backend.fetch, backendBaseUrl: BASE, ...(viewer ? { viewer } : {}) }) as never],
        permission: { projectScope: (options) => new ProjectScope({ ...options, fetch: backend.fetch, backendBaseUrl: BASE }) },
      },
    );
    const session = crypto.randomUUID();
    const events: TransportEvent[] = [];
    try {
      await fixture.sessions.createSession({ session_id: session, project_id: "prj-a" });
      fixture.registry.subscribe(session, (event) => events.push(event));
      await fixture.commands.accept(session, {
        command_id: crypto.randomUUID(), type: "prompt", content: "measure", connection: TEST_CONNECTION,
        viewer: viewerOn("tech_0450", { task: "fetal_hc" }),
      });
      await fixture.registry.waitForIdle(session);
      const end = events.find((e): e is Extract<TransportEvent, { event: "tool.end" }> => e.event === "tool.end");
      expect(end?.data.is_error).toBe(true);
      expect(end?.data.error_text).toMatch(/does not belong/u);
      expect(backend.paths()).not.toContain("/task/run");
      const opened = await fixture.sessions.openSession(session);
      try {
        const decisions = (await opened.getEntries()).filter((e) => e.type === "custom" && e.customType === "glaux.permission.decision");
        expect((decisions[0] as { data: unknown }).data).toMatchObject({ tool: RUN_TASK_TOOL_NAME, decision: "deny", basis: "project" });
      } finally {
        await fixture.sessions.closeSession(opened);
      }
    } finally {
      await fixture.close();
    }
  });
});
