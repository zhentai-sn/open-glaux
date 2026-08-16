// 图册树（SDD feats/03 v1.1 D-20 / §15 v1.1）：路径拼树 + 子树计数累加；未分册单列；点节点产生前缀筛选。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { buildCollectionTree, CollectionTree, normalizeKey } from "./CollectionTree";

const COUNTS = [
  { collection: "肾脏/膜性肾病/EDD", key: "肾脏/膜性肾病/edd", count: 4 },
  { collection: "肾脏/膜性肾病", key: "肾脏/膜性肾病", count: 1 },
  { collection: "肾脏/IgA", key: "肾脏/iga", count: 2 },
  { collection: "", key: "", count: 3 },
];

describe("buildCollectionTree", () => {
  it("按路径分级、子树计数累加、根目录单列为未分册", () => {
    const { roots, unfiled, total } = buildCollectionTree(COUNTS);
    expect(total).toBe(10);
    expect(unfiled).toBe(3);
    expect(roots).toHaveLength(1);
    const kidney = roots[0]!;
    expect(kidney).toMatchObject({ name: "肾脏", path: "肾脏", own: 0, total: 7 });
    expect(kidney.children.map((c) => [c.name, c.own, c.total])).toEqual([
      ["IgA", 2, 2],
      ["膜性肾病", 1, 5],
    ]);
    expect(kidney.children[1]!.children[0]).toMatchObject({ name: "EDD", path: "肾脏/膜性肾病/EDD", total: 4 });
  });

  it("normalizeKey 与后端归一一致（段 trim / 全角斜杠 / 大小写）", () => {
    expect(normalizeKey(" 肾脏 / 膜性肾病 ／ EDD ")).toBe("肾脏/膜性肾病/edd");
    expect(normalizeKey("Kidney//MN/")).toBe("kidney/mn");
  });
});

describe("CollectionTree", () => {
  it("点节点 → 前缀筛选；未分册 → exact；全部 → null", () => {
    localStorage.setItem("glaux.lang", "en");
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <CollectionTree counts={COUNTS} filter={null} onChange={onChange} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^肾脏/ }));
    expect(onChange).toHaveBeenLastCalledWith({ path: "肾脏", exact: false });
    fireEvent.click(screen.getByRole("button", { name: /Unfiled/ }));
    expect(onChange).toHaveBeenLastCalledWith({ path: "", exact: true });
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    // 深层节点默认折叠，展开后可点
    expect(screen.queryByRole("button", { name: /^EDD/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "expand" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^EDD/ }));
    expect(onChange).toHaveBeenLastCalledWith({ path: "肾脏/膜性肾病/EDD", exact: false });
  });
});
