/**
 * SDD 15 W1：工具迁入插件前后，系统提示词逐字不变。
 * 快照在迁移前生成，迁移后必须原样通过。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
import { defaultToolFactory, systemPromptFor } from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import type { VideoTurn } from "../../src/pi/video-turn.js";
import { TEST_CONNECTION } from "../helpers/runtime-fixture.js";
import { FIXTURE_OBJECT_IDS, viewerOn } from "../helpers/viewer-fixture.js";

const runtime = {} as ModelRuntime;
const videoTurn = {} as VideoTurn;

function prompt(context: HarnessToolContext, video?: { duration_ms: number; has_audio: boolean }): { tools: string[]; prompt: string } {
  const tools = defaultToolFactory(context);
  return { tools: tools.map((tool) => tool.name), prompt: systemPromptFor(context.viewer, tools, context, video) };
}

afterEach(() => vi.unstubAllEnvs());

describe("system prompt assembly", () => {
  it("no focus, text-only connection", () => {
    expect(prompt({ permissionMode: "controlled", connection: TEST_CONNECTION })).toMatchSnapshot();
  });

  it("image focus, vision connection, project bound, segmentation enabled", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-only");
    expect(prompt({
      permissionMode: "controlled",
      connection: { ...TEST_CONNECTION, vision: true },
      runtime,
      projectId: "prj-00000000",
      viewer: viewerOn(FIXTURE_OBJECT_IDS.image, { task: "far_wall_cca_imt", collection: "cubs" }),
    })).toMatchSnapshot();
  });

  it("video focus with joint audio-video turn", () => {
    expect(prompt({
      permissionMode: "controlled",
      connection: { ...TEST_CONNECTION, vision: true, media_adapter: "qwen-omni" },
      runtime,
      videoTurn,
      viewer: viewerOn(FIXTURE_OBJECT_IDS.video, { index: { t: 12 } }),
    }, { duration_ms: 90_000, has_audio: true })).toMatchSnapshot();
  });

  it("observe mode keeps only video tools", () => {
    expect(prompt({
      permissionMode: "observe",
      connection: { ...TEST_CONNECTION, vision: true },
      runtime,
      videoTurn,
      viewer: viewerOn(FIXTURE_OBJECT_IDS.video),
    }).tools).toEqual(["observe_video_interval", "submit_video_answer"]);
  });
});
