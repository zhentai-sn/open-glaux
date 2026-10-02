/** SDD 16 §7.5 规则 2：bash 环境变量白名单。 */
import { describe, expect, it } from "vitest";

import { buildShellEnv } from "../../src/workspace/shell-env.js";

describe("buildShellEnv", () => {
  it("passes only allowlisted variables plus GLAUX_CWD", () => {
    const env = buildShellEnv("/work", {
      PATH: "/usr/bin", HOME: "/home/u", LANG: "C.UTF-8",
      GLAUX_SEG_API_TOKEN: "secret", OPENAI_API_KEY: "k", GITEE_AI_TOKEN: "t", GLAUX_HOME: "/g", NODE_OPTIONS: "--x",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/u", LANG: "C.UTF-8", GLAUX_CWD: "/work" });
  });
});
