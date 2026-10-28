/** SDD 25 §7.8：needs_pack 挂载判定与工具目录透出。 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { toolCatalog, unavailableReason } from "../../src/plugins/registry.js";
import type { GlauxPlugin, PluginTool } from "../../src/plugins/types.js";
import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
import { readyPacks, resetPackCache } from "../../src/packs/client.js";

const ctx = (readyPacks?: ReadonlySet<string>): HarnessToolContext =>
  ({
    connection: { provider: "test", model: "test", vision: true },
    ...(readyPacks ? { readyPacks } : {}),
  }) as unknown as HarnessToolContext;

const packTool = (pack: string): PluginTool => ({
  name: "demo_pack_tool",
  effect: "compute",
  requires: { vision: true, pack },
  supports: () => true,
  create: () => { throw new Error("not created"); },
  promptFragment: () => "",
});

const plugin: GlauxPlugin = {
  name: "demo",
  applies: () => true,
  tools: [packTool("depth-dav2s")],
};

describe("needs_pack gating", () => {
  it("reports needs_pack when the pack is not ready", () => {
    const reason = unavailableReason(plugin, plugin.tools![0]!, ctx(new Set<string>(["other-pack"])));
    expect(reason).toBe("needs_pack");
  });

  it("has no reason when the pack is ready", () => {
    const reason = unavailableReason(plugin, plugin.tools![0]!, ctx(new Set(["depth-dav2s"])));
    expect(reason).toBeUndefined();
  });

  it("treats a missing readyPacks set as not ready", () => {
    expect(unavailableReason(plugin, plugin.tools![0]!, ctx())).toBe("needs_pack");
  });

  it("exposes the pack id in the tool catalogue", () => {
    const item = toolCatalog([plugin]).find((entry) => entry.name === "demo_pack_tool");
    expect(item?.pack).toBe("depth-dav2s");
    expect(item?.requires).toContain("pack");
  });

  it("omits pack for tools that do not declare it", () => {
    const plain: GlauxPlugin = {
      name: "plain",
      applies: () => true,
      tools: [{
        name: "plain_tool", effect: "read", requires: {}, supports: () => true,
        create: () => { throw new Error("not created"); }, promptFragment: () => "",
      }],
    };
    const item = toolCatalog([plain]).find((entry) => entry.name === "plain_tool");
    expect(item?.pack).toBeUndefined();
  });
});

describe("readyPacks client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => { resetPackCache(); });
  afterEach(() => { globalThis.fetch = originalFetch; resetPackCache(); });

  it("collects ids whose status is ready", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      packs: [
        { id: "vision-runtime", status: "ready" },
        { id: "depth-dav2s", status: "absent" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const ids = await readyPacks(0);
    expect([...ids]).toEqual(["vision-runtime"]);
  });

  it("degrades to an empty set when the backend fails", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const ids = await readyPacks(0);
    expect(ids.size).toBe(0);
  });

  it("caches within the TTL window", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ packs: [{ id: "a", status: "ready" }] }),
      { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    globalThis.fetch = spy;
    await readyPacks(1_000);
    await readyPacks(2_000);
    expect(spy).toHaveBeenCalledTimes(1);
    await readyPacks(1_000 + 10_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
