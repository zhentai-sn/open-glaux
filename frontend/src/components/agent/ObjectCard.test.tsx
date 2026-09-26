// SDD 13 §7.3 规则 4：open_file 不改焦点，由用户点「在舞台打开」。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as actions from "../../data/actions";
import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { ObjectCard, parseObjectOpened } from "./ObjectCard";

const details = {
  kind: "glaux.object_opened",
  path: "photos/cat.jpg",
  object: { id: "nat-1", kind: "image", modality: "natural_image", source_id: "psrc-1", display_name: "cat.jpg", axes: [] },
};

describe("ObjectCard", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    vi.restoreAllMocks();
    useSession.setState({ focus: null, uiMode: "focus" });
  });

  it("解析 open_file 的 details，形状不符返回 null", () => {
    expect(parseObjectOpened(details)).toEqual({
      id: "nat-1",
      kind: "image",
      modality: "natural_image",
      name: "cat.jpg",
      path: "photos/cat.jpg",
    });
    expect(parseObjectOpened({ kind: "glaux.object_opened" })).toBeNull();
    expect(parseObjectOpened({ kind: "other", object: details.object })).toBeNull();
  });

  it("点「在舞台打开」才改焦点并展开舞台", async () => {
    const open = vi.spyOn(actions, "openObject").mockResolvedValue(undefined);
    useSession.getState().setFocusLayout({ railOpen: true });
    render(
      <I18nProvider>
        <ObjectCard payload={parseObjectOpened(details)!} />
      </I18nProvider>,
    );
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open on stage" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("nat-1", "natural_image"));
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, sideView: "stage" });
    // 对话内卡片打开不收起会话列表（SDD 01 §7 第 9 条、D28）
    expect(useSession.getState().focusLayout.railOpen).toBe(true);
  });

  it("对象已在舞台时按钮禁用", () => {
    useSession.setState({ focus: { object_id: "nat-1", kind: "image", index: {}, region: null } });
    render(
      <I18nProvider>
        <ObjectCard payload={parseObjectOpened(details)!} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "On stage" })).toBeDisabled();
  });
});
