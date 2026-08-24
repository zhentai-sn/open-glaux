/**
 * 建议标注卡片（SDD 02 §6 / §7.3）。
 *
 * 守住的不变量：卡片状态取自 store 里那条标注的**实时** status，不是提出时的快照；
 * 确认/驳回只发一次 PATCH 且带 base_seq；未提出（annotation_id 为 null）不渲染卡片。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation } from "../../api/types";
import { I18nProvider } from "../../i18n";
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
  updateMock.mockReset();
  updateMock.mockResolvedValue({ annotation: ann({ status: "confirmed", seq: 4 }) });
  useSession.setState({ annotations: [ann()] });
});

describe("parseAnnotationProposed", () => {
  it("解析工具结果 details", () => {
    const p = parseAnnotationProposed({
      kind: "glaux.annotation_proposed",
      payload: { annotation_id: "a1", image_id: "i1", label: "x", note: "因为形态符合" },
    });
    expect(p).toMatchObject({ annotation_id: "a1", label: "x", note: "因为形态符合" });
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

  it("确认发一次 PATCH，带 base_seq 与 confirmed", () => {
    show(PAYLOAD);
    fireEvent.click(screen.getByTestId("suggestion-confirm"));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith("ann_1", { base_seq: 3, status: "confirmed" });
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

  it("本次未提出（annotation_id 为 null）不渲染卡片", () => {
    show({ annotation_id: null, image_id: "", label: "x", reason: "no_image" });
    expect(screen.queryByTestId("suggestion-card")).toBeNull();
  });

  it("有 note 时显示理由", () => {
    show({ ...PAYLOAD, note: "边界与周围实质对比明显" });
    expect(screen.getByText(/边界与周围实质对比明显/u)).toBeTruthy();
  });
});
