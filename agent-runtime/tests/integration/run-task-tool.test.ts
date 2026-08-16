import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { TransportEvent } from "../../src/contracts.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import {
  RUN_TASK_TOOL_NAME,
  TASK_OUTPUT_DETAILS_KIND,
  backendBaseUrl,
  createRunTaskTool,
} from "../../src/pi/tools/run-task.js";
import {
  TEST_CONNECTION,
  createRuntimeFixture,
  waitFor,
} from "../helpers/runtime-fixture.js";

type FetchLike = typeof globalThis.fetch;

const TASK_OUTPUT = {
  task: "far_wall_cca_imt",
  metrics: {
    IMT_mean: { value: 0.6234, unit: "mm", label_en: "IMT mean", label_zh: "平均 IMT" },
    IMT_max: { value: 0.81, unit: "mm", label_en: "IMT max", label_zh: "最大 IMT" },
  },
  primitives: [{ id: "LI", role: "LI", points: [[0, 1]] }],
  provenance: { model_version: "caroSegDeep@1" },
};

function fetchRecorder(handler: (url: string, body: unknown) => Response) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as unknown as FetchLike;
  return { fetch: f, calls };
}

const ok = () =>
  new Response(JSON.stringify(TASK_OUTPUT), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("run_task tool (unit)", () => {
  it("defaults to the viewer context and posts to backend /task/run", async () => {
    const { fetch, calls } = fetchRecorder(ok);
    const tool = createRunTaskTool({
      fetch,
      backendBaseUrl: "http://backend.test",
      viewer: { image_id: "tech_401", task: "far_wall_cca_imt", method: "caroSegDeep", cubs_cf: 0.06 },
    });
    const result = await tool.execute("call-1", {}, undefined, undefined, undefined);

    expect(calls).toEqual([
      {
        url: "http://backend.test/task/run",
        body: { task: "far_wall_cca_imt", image_id: "tech_401", method: "caroSegDeep", cubs_cf: 0.06 },
      },
    ]);
    expect(result.details).toEqual({
      kind: TASK_OUTPUT_DETAILS_KIND,
      task: "far_wall_cca_imt",
      image_id: "tech_401",
      output: TASK_OUTPUT,
    });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("IMT mean (IMT_mean): 0.623 mm");
    expect(text).toContain("caroSegDeep@1");
  });

  it("lets explicit params override the viewer and forwards roi_box", async () => {
    const { fetch, calls } = fetchRecorder(ok);
    const tool = createRunTaskTool({
      fetch,
      backendBaseUrl: "http://backend.test",
      viewer: { image_id: "slide_001", task: "nuclei_detection", roi_box: [10, 20, 300, 400] },
    });
    await tool.execute("c", { image_id: "slide_002", method: "stardist_he" }, undefined, undefined, undefined);
    expect(calls[0]?.body).toEqual({
      task: "nuclei_detection",
      image_id: "slide_002",
      method: "stardist_he",
      roi_box: [10, 20, 300, 400],
    });
  });

  it("throws a helpful error when no image / task is known", async () => {
    const { fetch, calls } = fetchRecorder(ok);
    const tool = createRunTaskTool({ fetch, backendBaseUrl: "http://backend.test" });
    await expect(tool.execute("c", {}, undefined, undefined, undefined)).rejects.toThrow(/No image is open/u);
    await expect(
      tool.execute("c", { image_id: "x" }, undefined, undefined, undefined),
    ).rejects.toThrow(/No task is selected/u);
    expect(calls).toEqual([]);
  });

  it("surfaces backend rejections with their detail", async () => {
    const { fetch } = fetchRecorder(
      () =>
        new Response(JSON.stringify({ detail: "标定不可用：无 CF" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    const tool = createRunTaskTool({
      fetch,
      backendBaseUrl: "http://backend.test",
      viewer: { image_id: "tech_401", task: "far_wall_cca_imt" },
    });
    await expect(tool.execute("c", {}, undefined, undefined, undefined)).rejects.toThrow(
      /标定不可用/u,
    );
  });

  it("reads the backend base url from GLAUX_BACKEND_URL", () => {
    expect(backendBaseUrl({} as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:8000");
    expect(backendBaseUrl({ GLAUX_BACKEND_URL: "http://10.0.0.2:9000/" } as NodeJS.ProcessEnv)).toBe(
      "http://10.0.0.2:9000",
    );
  });
});

describe("default tool factory", () => {
  it("exposes run_task except in observe mode", () => {
    expect(defaultToolFactory({ permissionMode: "controlled" }).map((t) => t.name)).toEqual([
      RUN_TASK_TOOL_NAME,
    ]);
    expect(defaultToolFactory({ permissionMode: "suggest" })).toHaveLength(1);
    expect(defaultToolFactory({ permissionMode: "observe" })).toEqual([]);
  });
});

describe("run_task through the harness (integration)", () => {
  it("executes the tool call, emits tool_execution_end with task output, and lets the model answer", async () => {
    const { fetch, calls } = fetchRecorder(ok);
    const fixture = await createRuntimeFixture(
      [
        [
          fauxAssistantMessage(fauxToolCall(RUN_TASK_TOOL_NAME, {}), { stopReason: "toolUse" }),
          fauxAssistantMessage("The mean IMT is 0.62 mm."),
        ],
      ],
      {
        toolFactory: ({ viewer }) => [
          createRunTaskTool({ fetch, backendBaseUrl: "http://backend.test", ...(viewer ? { viewer } : {}) }),
        ],
      },
    );
    const sessionId = crypto.randomUUID();
    const events: TransportEvent[] = [];
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      fixture.registry.subscribe(sessionId, (event) => events.push(event));
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "measure the IMT",
        connection: TEST_CONNECTION,
        viewer: { image_id: "tech_401", task: "far_wall_cca_imt", cubs_cf: 0.06 },
      });
      await fixture.registry.waitForIdle(sessionId);
      const isToolEnd = (e: TransportEvent) =>
        e.event === "pi.event" &&
        (e.data.event as { type?: string }).type === "tool_execution_end";
      await waitFor(() => events.some(isToolEnd));

      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toEqual({ task: "far_wall_cca_imt", image_id: "tech_401", cubs_cf: 0.06 });

      const toolEnd = events.find(isToolEnd) as Extract<TransportEvent, { event: "pi.event" }>;
      const payload = toolEnd.data.event as {
        toolName: string;
        isError: boolean;
        result: { details: unknown };
      };
      expect(payload.toolName).toBe(RUN_TASK_TOOL_NAME);
      expect(payload.isError).toBe(false);
      expect(payload.result.details).toMatchObject({
        kind: TASK_OUTPUT_DETAILS_KIND,
        image_id: "tech_401",
        output: { metrics: { IMT_mean: { value: 0.6234 } } },
      });

      const view = await fixture.sessions.getSession(sessionId);
      const last = view.messages.at(-1) as { role?: string; content?: unknown };
      expect(last.role).toBe("assistant");
      expect(JSON.stringify(last.content)).toContain("0.62 mm");
    } finally {
      await fixture.close();
    }
  });

  it("observe mode: model has no tools, so a tool call is rejected without touching backend", async () => {
    const { fetch, calls } = fetchRecorder(ok);
    const fixture = await createRuntimeFixture(
      [[fauxAssistantMessage(fauxToolCall(RUN_TASK_TOOL_NAME, {}), { stopReason: "toolUse" }), fauxAssistantMessage("ok")]],
      {
        toolFactory: (opts) =>
          opts.permissionMode === "observe"
            ? []
            : [createRunTaskTool({ fetch, backendBaseUrl: "http://backend.test", ...(opts.viewer ? { viewer: opts.viewer } : {}) })],
      },
    );
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId, permission_mode: "observe" });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "measure",
        connection: TEST_CONNECTION,
        viewer: { image_id: "tech_401", task: "far_wall_cca_imt" },
      });
      await fixture.registry.waitForIdle(sessionId);
      expect(calls).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
