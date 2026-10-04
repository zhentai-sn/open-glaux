/**
 * 工具参数 schema 的跨端点兼容性：OpenAI 兼容端点（如 deepseek）只接受单个 schema 的 `items`，
 * 元组写法（`items: [...]`，TypeBox 的 `Type.Tuple`）会让整条模型请求被拒。
 */
import { describe, expect, it } from "vitest";

import { PLUGINS, pluginTools } from "../../src/plugins/registry.js";
import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
import { TEST_CONNECTION } from "../helpers/runtime-fixture.js";

/** 返回 schema 中所有元组写法的位置。 */
function tuplePaths(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) return schema.flatMap((item, i) => tuplePaths(item, `${path}[${i}]`));
  const node = schema as Record<string, unknown>;
  const own = Array.isArray(node.items) || "prefixItems" in node ? [path] : [];
  return [...own, ...Object.entries(node).flatMap(([key, value]) => tuplePaths(value, `${path}.${key}`))];
}

const ctx = {
  cwd: "/tmp",
  execEnv: {} as never,
  connection: { ...TEST_CONNECTION, vision: true },
  projectId: "prj-test",
  permissionMode: "autonomous",
  viewer: { focus: { object_id: "obj", kind: "image", index: { z: null, t: null, level: null } } },
  runtime: {} as never,
  agents: [],
} as unknown as HarnessToolContext;

describe("tool parameter schemas", () => {
  it("use no tuple items, which OpenAI-compatible endpoints reject", () => {
    const created = pluginTools(PLUGINS).flatMap((tool) => {
      try {
        return [tool.create(ctx)].flat();
      } catch {
        return [];
      }
    });
    // 至少覆盖曾出过问题的 propose_annotation，避免构造失败让本测试空转
    expect(created.map((tool) => tool.name)).toContain("propose_annotation");
    const offenders = created.flatMap((tool) => tuplePaths(tool.parameters).map((path) => `${tool.name} ${path}`));
    expect(offenders).toEqual([]);
  });
});
