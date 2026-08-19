// annotationBridge 测试（SDD 04 T3）——唯一编辑回流桥的行为契约：
// 乐观草稿先行、失败回滚、409 提示、过期响应丢弃（editSeq 序号守卫）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetEditSeqForTest,
  createAnnotation,
  loadAnnotations,
  patchAnnotation,
  removeAnnotation,
} from "./bridge";
import type { Annotation } from "../api/types";
import { useSession } from "../store/session";

type FetchInit = { method?: string; body?: string } | undefined;

/** 可控 fetch：按 (method, url) 路由到预置响应；deferred 用例可手动放行。 */
function mockFetch(
  handler: (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; json?: unknown }>,
) {
  const fn = vi.fn(async (url: string, init: FetchInit) => {
    const r = await handler(url, init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json ?? {},
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeAnn(id: string, seq = 1): Annotation {
  return {
    id,
    image_id: "img_1",
    z: null,
    primitive: { kind: "bbox", x0: 1, y0: 2, x1: 10, y1: 20 },
    label: "",
    class_id: null,
    status: "confirmed",
    source: "manual",
    seq,
  };
}

beforeEach(() => {
  _resetEditSeqForTest();
  useSession.getState().setAnnotations([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAnnotation", () => {
  it("成功：乐观草稿先行，落库后换真 id（无 tmp 残留）", async () => {
    const saved = makeAnn("srv-1");
    mockFetch(async () => ({ ok: true, status: 201, json: { annotation: saved, hook_result: null } }));

    const p = createAnnotation({ image_id: "img_1", primitive: saved.primitive });
    // 同步可见的乐观草稿
    const draft = useSession.getState().annotations;
    expect(draft).toHaveLength(1);
    expect(draft[0].id).toMatch(/^tmp-/);
    expect(draft[0].status).toBe("draft");

    const out = await p;
    expect(out?.id).toBe("srv-1");
    const anns = useSession.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].id).toBe("srv-1");
  });

  it("422：草稿回滚 + 明确拒绝提示", async () => {
    mockFetch(async () => ({ ok: false, status: 422, json: { detail: "几何越界" } }));
    const out = await createAnnotation({ image_id: "img_1", primitive: makeAnn("x").primitive });
    expect(out).toBeNull();
    expect(useSession.getState().annotations).toHaveLength(0);
    expect(useSession.getState().notices.slice(-1)[0]?.text).toContain("被拒绝");
  });

  it("mask 创建：入参携带 mask_png_b64，草稿同样先行", async () => {
    const saved = makeAnn("srv-m");
    saved.primitive = { kind: "mask", ref: "masks/srv-m.png" };
    const fetchFn = mockFetch(async () => ({ ok: true, status: 201, json: { annotation: saved, hook_result: null } }));
    const out = await createAnnotation({
      image_id: "img_1",
      primitive: { kind: "mask" },
      mask_png_b64: "iVBORw0KGgo=",
    });
    expect(out?.primitive).toEqual({ kind: "mask", ref: "masks/srv-m.png" });
    const body = JSON.parse((fetchFn.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>;
    expect(body.mask_png_b64).toBe("iVBORw0KGgo=");
    expect(useSession.getState().annotations.map((a) => a.id)).toEqual(["srv-m"]);
  });

  it("网络失败：草稿回滚 + 提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const out = await createAnnotation({ image_id: "img_1", primitive: makeAnn("x").primitive });
    expect(out).toBeNull();
    expect(useSession.getState().annotations).toHaveLength(0);
    expect(useSession.getState().notices.slice(-1)[0]?.tone).toBe("crit");
  });

  it("过期响应丢弃：后发编辑接管后，先到的慢响应不落 store", async () => {
    // 第一次 create 挂起，第二次 create 先行完成——第一次的响应到达时已过期
    let releaseFirst: ((v: { ok: boolean; status: number; json?: unknown }) => void) | null = null;
    const firstPending = new Promise<{ ok: boolean; status: number; json?: unknown }>((res) => {
      releaseFirst = res;
    });
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) return firstPending;
      return { ok: true, status: 201, json: { annotation: makeAnn("srv-2"), hook_result: null } };
    });

    const p1 = createAnnotation({ image_id: "img_1", primitive: makeAnn("x").primitive });
    const out2 = await createAnnotation({ image_id: "img_1", primitive: makeAnn("y").primitive });
    expect(out2?.id).toBe("srv-2");

    // 慢响应此刻才返回——应被序号守卫丢弃
    releaseFirst!({ ok: true, status: 201, json: { annotation: makeAnn("srv-1"), hook_result: null } });
    const out1 = await p1;
    expect(out1).toBeNull();
    const ids = useSession.getState().annotations.map((a) => a.id);
    expect(ids).toEqual(["srv-2"]);
  });
});

describe("patchAnnotation", () => {
  it("成功：store 更新为新版本", async () => {
    useSession.getState().upsertAnnotation(makeAnn("a1", 3));
    mockFetch(async () => ({ ok: true, status: 200, json: { annotation: makeAnn("a1", 4) } }));
    const out = await patchAnnotation("a1", 3, { label: "n" });
    expect(out?.seq).toBe(4);
    expect(useSession.getState().annotations[0].seq).toBe(4);
  });

  it("409：store 不动 + 冲突提示", async () => {
    useSession.getState().upsertAnnotation(makeAnn("a1", 3));
    mockFetch(async () => ({ ok: false, status: 409, json: { detail: "base_seq 过期" } }));
    const out = await patchAnnotation("a1", 2, { label: "n" });
    expect(out).toBeNull();
    expect(useSession.getState().annotations[0].seq).toBe(3);
    expect(useSession.getState().notices.slice(-1)[0]?.text).toContain("刷新");
  });
});

describe("removeAnnotation", () => {
  it("成功：store 移除", async () => {
    useSession.getState().upsertAnnotation(makeAnn("a1"));
    mockFetch(async () => ({ ok: true, status: 204 }));
    expect(await removeAnnotation("a1", 1)).toBe(true);
    expect(useSession.getState().annotations).toHaveLength(0);
  });

  it("409：保留 + 提示", async () => {
    useSession.getState().upsertAnnotation(makeAnn("a1"));
    mockFetch(async () => ({ ok: false, status: 409, json: { detail: "seq 过期" } }));
    expect(await removeAnnotation("a1", 0)).toBe(false);
    expect(useSession.getState().annotations).toHaveLength(1);
  });
});

describe("loadAnnotations", () => {
  it("拉取成功写入 store；失败静默不阻塞", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: { annotations: [makeAnn("a1")] } }));
    await loadAnnotations("img_1");
    expect(useSession.getState().annotations.map((a) => a.id)).toEqual(["a1"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await expect(loadAnnotations("img_1")).resolves.toBeUndefined();
  });
});
