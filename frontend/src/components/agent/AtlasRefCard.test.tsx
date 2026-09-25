// 会话卡片"参考图谱 N 条"（SDD feats/03 §5.1 / §12 / §13 · 验收 §15）：
// payload 解析；三种数量（0 / 选中 K / 被外发排除 M）渲染；案例已删除时快照降级；点开跳图谱详情。
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { ATLAS_REFERENCED_KIND, AtlasRefCard, parseAtlasReferenced } from "./AtlasRefCard";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const EX = (id: string, status: "active" | "retired" = "active") => ({
  exemplar_id: id,
  image_ref: "i",
  crop_ref: "c",
  image_sha256: "s",
  roi: [0, 0, 1, 1],
  geometry: null,
  tags: ["tem"],
  tags_raw: ["TEM"],
  caption: `caption ${id}`,
  notes: null,
  description: null,
  describe_status: "done",
  source_type: "textbook",
  source: {},
  egress: "shareable",
  egress_consent: null,
  status,
  created_at: "2026-08-16T00:00:00Z",
  import_batch_id: "b",
});

describe("parseAtlasReferenced", () => {
  it("接受裸 payload 与 {kind, payload} 包装；形状不符返回 null", () => {
    const p = { trace_id: "t", candidate_ids: ["a"], selected_ids: ["a"], excluded_by_egress: 1, snapshots: [{ exemplar_id: "a", caption: "c", tags: ["x"] }] };
    expect(parseAtlasReferenced(p)).toEqual(p);
    expect(parseAtlasReferenced({ kind: ATLAS_REFERENCED_KIND, payload: p })).toEqual(p);
    expect(parseAtlasReferenced({ trace_id: "t" })).toBeNull();
    expect(parseAtlasReferenced("nope")).toBeNull();
    expect(parseAtlasReferenced({ trace_id: "t", candidate_ids: [], selected_ids: [] })).toEqual({ trace_id: "t", candidate_ids: [], selected_ids: [], excluded_by_egress: 0, snapshots: [] });
  });
});

describe("AtlasRefCard", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ uiMode: "focus" });
    useAtlasUi.setState({ screen: "list", selectedId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const m = url.match(/\/atlas\/exemplars\/([^/?]+)$/);
        if (m?.[1] === "a") return jsonRes(EX("a"));
        if (m?.[1] === "r") return jsonRes(EX("r", "retired"));
        return jsonRes({ detail: { code: "NOT_FOUND", message: "nf" } }, 404);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const wrap = (payload: Parameters<typeof AtlasRefCard>[0]["payload"]) =>
    render(
      <I18nProvider>
        <AtlasRefCard payload={payload} />
      </I18nProvider>,
    );

  it("0 选中 → 无匹配文案，无条目", () => {
    wrap({ trace_id: "t", candidate_ids: [], selected_ids: [], excluded_by_egress: 0, snapshots: [] });
    expect(screen.getByText(/No atlas match/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("atlas-ref-item")).toHaveLength(0);
  });

  it("选中 2 条 + 候选 5 → 标题与候选数；活跃案例显示图注", async () => {
    wrap({ trace_id: "t", candidate_ids: ["a", "b", "c", "d", "e"], selected_ids: ["a", "r"], excluded_by_egress: 0, snapshots: [] });
    expect(screen.getByText("Referenced 2 atlas exemplar(s)")).toBeInTheDocument();
    expect(screen.getByText("5 candidates")).toBeInTheDocument();
    expect(await screen.findByText("caption a")).toBeInTheDocument();
    // 已下架的仍可打开，但带标记
    expect(await screen.findByText("retired")).toBeInTheDocument();
    expect(screen.queryByText(/not used/)).toBeNull();
  });

  it("被外发限制排除 → 提示条数；已删除案例用快照降级展示", async () => {
    wrap({
      trace_id: "t",
      candidate_ids: ["gone"],
      selected_ids: ["gone"],
      excluded_by_egress: 3,
      snapshots: [{ exemplar_id: "gone", caption: "snapshot caption", tags: ["TEM"] }],
    });
    expect(screen.getByText("3 local-only exemplar(s) not used (sharing restriction)")).toBeInTheDocument();
    expect(await screen.findByText("exemplar unavailable (retired or deleted)")).toBeInTheDocument();
    expect(screen.getByText("snapshot caption")).toBeInTheDocument();
  });

  it("点开条目 → focus 右侧切 atlas 并进入该案例详情", async () => {
    wrap({ trace_id: "t", candidate_ids: ["a"], selected_ids: ["a"], excluded_by_egress: 0, snapshots: [] });
    fireEvent.click(await screen.findByTestId("atlas-ref-item"));
    expect(useSession.getState().focusLayout.sideView).toBe("atlas");
    expect(useAtlasUi.getState()).toMatchObject({ screen: "detail", selectedId: "a" });
  });
});
