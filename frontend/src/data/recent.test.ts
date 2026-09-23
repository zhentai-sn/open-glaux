// SDD 10 §9.5：glaux.recent.v1 → v2 单向迁移（空 / 脏 / 旧三种输入）。
import { beforeEach, describe, expect, it } from "vitest";

import { RECENT_KEY, RECENT_KEY_V1, migrateV1, readRecent } from "./recent";

beforeEach(() => localStorage.clear());

describe("readRecent v1 → v2", () => {
  it("空：两个键都不存在 → 空数组，不写任何键", () => {
    expect(readRecent()).toEqual([]);
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it("旧：v1 条目按 modality 补 kind，推断不出的丢弃；写 v2、删 v1", () => {
    localStorage.setItem(
      RECENT_KEY_V1,
      JSON.stringify([
        { modality: "ct_abdomen", id: "ct_001", label: "ct_001", at: "2026-09-01T00:00:00Z" },
        { modality: "pathology", id: "slide_001", label: "slide_001", at: "2026-09-01T00:00:00Z" },
        { modality: "mri_brain", id: "m1", label: "m1", at: "2026-09-01T00:00:00Z" },
      ]),
    );
    const got = readRecent();
    expect(got.map((r) => [r.id, r.kind])).toEqual([
      ["ct_001", "volume"],
      ["slide_001", "slide"],
    ]);
    expect(localStorage.getItem(RECENT_KEY_V1)).toBeNull();
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual(got);
    // 迁移只做一次：再读直接走 v2
    localStorage.setItem(RECENT_KEY_V1, JSON.stringify([{ modality: "fetal_hc", id: "x", label: "x", at: "t" }]));
    expect(readRecent()).toEqual(got);
  });

  it("脏：v1 非法 JSON → 迁移为空且删掉旧键，不抛错", () => {
    localStorage.setItem(RECENT_KEY_V1, "{not json");
    expect(readRecent()).toEqual([]);
    expect(localStorage.getItem(RECENT_KEY_V1)).toBeNull();
  });

  it("脏：v2 结构不符的条目被滤掉", () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([{ modality: "video", kind: "video", id: "v", label: "v", at: "t" }, { id: 3 }, "x"]),
    );
    expect(readRecent().map((r) => r.id)).toEqual(["v"]);
  });

  it("migrateV1 是纯函数：不认的结构一律丢弃", () => {
    expect(migrateV1([null, 1, { modality: "carotid_imt" }])).toEqual([]);
  });
});
