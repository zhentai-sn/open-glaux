/**
 * 建议标注卡片（SDD 02 §6 / §7.3）。
 *
 * 守住的不变量：卡片状态取自 store 里那条标注的**实时** status，不是提出时的快照；
 * 确认/驳回只发一次 PATCH 且带 base_seq；未提出（annotation_id 为 null）不渲染卡片；
 * 卡片所属对象不在舞台上时显示"在其他对象上"而非"已不存在"（store 只装焦点对象的标注）。
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation, ObjectMeta } from "../../api/types";
import * as actions from "../../data/actions";
import { I18nProvider } from "../../i18n";
import { useLabels } from "../../store/labels";
import { useSession } from "../../store/session";
import { SuggestionCard, parseAnnotationProposed } from "./SuggestionCard";

const updateMock = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  const api = mod.api as Record<string, Record<string, unknown>>;
  return { ...mod, api: { ...api, annotations: { ...api.annotations, update: updateMock } } };
});

function ann(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_1",
    image_id: "img_1",
    primitive: { kind: "bbox", x0: 1, y0: 1, x1: 9, y1: 9 },
    label: "左肾",
    status: "suggested",
    source: "agent",
    seq: 3,
    ...over,
  };
}

function show(payload: Parameters<typeof SuggestionCard>[0]["payload"]) {
  return render(
    <I18nProvider>
      <SuggestionCard payload={payload} />
    </I18nProvider>,
  );
}

const PAYLOAD = { annotation_id: "ann_1", image_id: "img_1", label: "左肾" };

beforeEach(() => {
  vi.restoreAllMocks();
  updateMock.mockReset();
  updateMock.mockResolvedValue({ annotation: ann({ status: "confirmed", seq: 4 }) });
  useSession.setState({
    annotations: [ann()],
    focus: { object_id: "img_1", kind: "image", index: {}, region: null },
    objects: {},
    uiMode: "focus",
  });
});

describe("parseAnnotationProposed", () => {
  it("解析工具结果 details", () => {
    const p = parseAnnotationProposed({
      kind: "glaux.annotation_proposed",
      payload: { annotation_id: "a1", image_id: "i1", label: "x", note: "因为形态符合", index: { z: 42 } },
    });
    expect(p).toMatchObject({ annotation_id: "a1", label: "x", note: "因为形态符合", index: { z: 42 } });
    expect(p).not.toHaveProperty("modality");
  });

  it("解析所属对象的 modality", () => {
    const p = parseAnnotationProposed({
      kind: "glaux.annotation_proposed",
      payload: { annotation_id: "a1", image_id: "i1", modality: "natural_image", label: "x" },
    });
    expect(p?.modality).toBe("natural_image");
  });

  it("annotation_id 为 null（本次未提出）仍可解析，带 reason", () => {
    const p = parseAnnotationProposed({
      kind: "glaux.annotation_proposed",
      payload: { annotation_id: null, image_id: "", label: "x", reason: "no_image" },
    });
    expect(p?.annotation_id).toBeNull();
    expect(p?.reason).toBe("no_image");
  });

  it("形状不符返回 null", () => {
    expect(parseAnnotationProposed({ kind: "other", payload: {} })).toBeNull();
    expect(parseAnnotationProposed(null)).toBeNull();
  });
});

describe("SuggestionCard", () => {
  it("待确认时显示标签与两个动作", () => {
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-card")).toBeTruthy();
    expect(screen.getByText(/左肾/u)).toBeTruthy();
    // 断言状态类而非文案：测试环境默认英文，文案随语言变，状态类不变
    expect(screen.getByTestId("suggestion-badge").className).toContain("suggested");
    expect(screen.getByTestId("suggestion-confirm")).toBeTruthy();
    expect(screen.getByTestId("suggestion-reject")).toBeTruthy();
  });

  it("确认发一次 PATCH，带 base_seq 与 confirmed（标签已在目录中）", () => {
    useSession.setState({ annotations: [ann({ label_id: "lbl-1" })] });
    show(PAYLOAD);
    fireEvent.click(screen.getByTestId("suggestion-confirm"));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith("ann_1", { base_seq: 3, status: "confirmed" });
  });

  it("标签未入目录时先弹出标签选择，预填其文本，选定前不确认（SDD 23 §7.5 规则 4）", async () => {
    useLabels.setState({ objectId: "img_1", scope: "global", labels: [], request: null });
    show(PAYLOAD);
    fireEvent.click(screen.getByTestId("suggestion-confirm"));
    await vi.waitFor(() => expect(useLabels.getState().request?.prefill).toBe("左肾"));
    expect(updateMock).not.toHaveBeenCalled();
    useLabels.getState().settle(null);
  });

  it("驳回发 rejected", () => {
    show(PAYLOAD);
    fireEvent.click(screen.getByTestId("suggestion-reject"));
    expect(updateMock).toHaveBeenCalledWith("ann_1", { base_seq: 3, status: "rejected" });
  });

  it("已确认的建议不再显示动作按钮——状态取 store 实时值", () => {
    useSession.setState({ annotations: [ann({ status: "confirmed" })] });
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-badge").className).toContain("confirmed");
    expect(screen.queryByTestId("suggestion-confirm")).toBeNull();
  });

  it("已驳回同样不给动作", () => {
    useSession.setState({ annotations: [ann({ status: "rejected" })] });
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-badge").className).toContain("rejected");
    expect(screen.queryByTestId("suggestion-reject")).toBeNull();
  });

  it("标注已被删除时降级展示，不给动作", () => {
    useSession.setState({ annotations: [] });
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-badge").className).toContain("missing");
    expect(screen.queryByTestId("suggestion-confirm")).toBeNull();
  });

  it("舞台换成其他对象时显示「在其他对象上」，不判为已删除", () => {
    // 焦点切到 WSI 后 store 只装 WSI 的标注
    useSession.setState({
      annotations: [ann({ id: "ann_wsi", image_id: "wsi_1" })],
      focus: { object_id: "wsi_1", kind: "slide", index: {}, region: null },
    });
    show(PAYLOAD);
    const badge = screen.getByTestId("suggestion-badge");
    expect(badge.className).toContain("elsewhere");
    expect(badge.className).not.toContain("missing");
    expect(screen.queryByTestId("suggestion-confirm")).toBeNull();
  });

  it("没有焦点对象时同样不判为已删除", () => {
    useSession.setState({ annotations: [], focus: null });
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-badge").className).toContain("elsewhere");
  });

  it("所属对象在对象清单里时给出打开入口，点击切到该对象并展开舞台", async () => {
    const open = vi.spyOn(actions, "openObject").mockResolvedValue(undefined);
    const cat = { id: "img_1", kind: "image", modality: "natural_image" } as ObjectMeta;
    useSession.setState({
      annotations: [],
      focus: { object_id: "wsi_1", kind: "slide", index: {}, region: null },
      objects: { natural_image: [cat] },
    });
    useSession.getState().setFocusLayout({ rightOpen: false, sideView: "context" });
    show(PAYLOAD);
    fireEvent.click(screen.getByTestId("suggestion-open-object"));
    expect(open).toHaveBeenCalledWith("img_1", "natural_image");
    await waitFor(() => expect(useSession.getState().focusLayout.rightOpen).toBe(true));
    expect(useSession.getState().focusLayout.sideView).toBe("stage");
  });

  it("对象清单未加载时用 payload.modality 给出打开入口", () => {
    const open = vi.spyOn(actions, "openObject").mockResolvedValue(undefined);
    useSession.setState({
      annotations: [],
      focus: { object_id: "wsi_1", kind: "slide", index: {}, region: null },
    });
    show({ ...PAYLOAD, modality: "natural_image" });
    fireEvent.click(screen.getByTestId("suggestion-open-object"));
    expect(open).toHaveBeenCalledWith("img_1", "natural_image");
  });

  it("所属对象不在对象清单里且无 modality（旧快照）时只显示状态，不给打开入口", () => {
    useSession.setState({
      annotations: [],
      focus: { object_id: "wsi_1", kind: "slide", index: {}, region: null },
    });
    show(PAYLOAD);
    expect(screen.queryByTestId("suggestion-open-object")).toBeNull();
  });

  it("切回所属对象后恢复实时状态与动作", () => {
    useSession.setState({ focus: { object_id: "wsi_1", kind: "slide", index: {}, region: null }, annotations: [] });
    show(PAYLOAD);
    expect(screen.getByTestId("suggestion-badge").className).toContain("elsewhere");
    act(() =>
      useSession.setState({ focus: { object_id: "img_1", kind: "image", index: {}, region: null }, annotations: [ann()] }),
    );
    expect(screen.getByTestId("suggestion-badge").className).toContain("suggested");
    expect(screen.getByTestId("suggestion-confirm")).toBeTruthy();
  });

  it("本次未提出（annotation_id 为 null）不渲染卡片", () => {
    show({ annotation_id: null, image_id: "", label: "x", reason: "no_image" });
    expect(screen.queryByTestId("suggestion-card")).toBeNull();
  });

  it("有 note 时显示理由", () => {
    show({ ...PAYLOAD, note: "边界与周围实质对比明显" });
    expect(screen.getByText(/边界与周围实质对比明显/u)).toBeTruthy();
  });
});
