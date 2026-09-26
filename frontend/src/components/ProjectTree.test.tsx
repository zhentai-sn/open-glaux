// SDD 13 §7.2 / §7.8：项目目录树按需展开，点击可识别文件经后端校验后打开。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../api/client";
import * as actions from "../data/actions";
import { I18nProvider } from "../i18n";
import { useProjects } from "../store/projects";
import { useSession } from "../store/session";
import { objectMeta } from "../test/fixtures";
import { ProjectTree } from "./ProjectTree";

const project = {
  id: "prj-a",
  name: "liver",
  path: "/x/liver",
  display_path: "C:\\x\\liver",
  created_at: "2026-09-25T00:00:00.000Z",
  status: "ok" as const,
};

function renderTree() {
  return render(
    <I18nProvider>
      <ProjectTree projectId="prj-a" />
    </I18nProvider>,
  );
}

describe("ProjectTree", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    vi.restoreAllMocks();
    useProjects.setState({ projects: [project], loaded: true });
    useSession.setState({ document: null, documentError: null, documentLoading: false });
    vi.spyOn(api, "projectEntries").mockImplementation(async (_id, path = "") =>
      path === ""
        ? {
            path: "",
            total: 3,
            entries: [
              { name: "photos", path: "photos", type: "dir", modality: null, object_id: null },
              { name: "scan.nii.gz", path: "scan.nii.gz", type: "file", modality: "ct_abdomen", object_id: null },
              { name: "readme.txt", path: "readme.txt", type: "file", modality: null, object_id: null },
            ],
          }
        : {
            path,
            total: 1,
            entries: [{ name: "cat.jpg", path: "photos/cat.jpg", type: "file", modality: "natural_image", object_id: null }],
          },
    );
  });

  it("根目录默认展开；子目录点击后才请求", async () => {
    renderTree();
    expect(await screen.findByText("photos")).toBeInTheDocument();
    expect(api.projectEntries).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("photos"));
    expect(await screen.findByText("cat.jpg")).toBeInTheDocument();
    expect(api.projectEntries).toHaveBeenLastCalledWith("prj-a", "photos");
  });

  it("点击可识别文件经 openProjectFile 打开", async () => {
    const open = vi
      .spyOn(actions, "openProjectFile")
      .mockResolvedValue(objectMeta({ id: "nat-1", modality: "natural_image" }));
    renderTree();
    fireEvent.click(await screen.findByText("photos"));
    fireEvent.click(await screen.findByText("cat.jpg"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("prj-a", "photos/cat.jpg"));
  });

  // SDD 01 §7 第 9 条（v1.8）：文件浏览器打开即收起会话列表，其余布局不变；Workbench 不改写
  it("Focus 下打开图像或文本文件时收起会话列表，其余布局不变", async () => {
    vi.spyOn(actions, "openProjectFile").mockResolvedValue(objectMeta({ id: "nat-1", modality: "natural_image" }));
    const layout = { ...useSession.getState().focusLayout, railOpen: true, browserView: "files" as const, sideW: 700 };
    useSession.setState({ uiMode: "focus", focusLayout: layout });
    renderTree();
    fireEvent.click(await screen.findByText("photos"));
    fireEvent.click(await screen.findByText("cat.jpg"));
    expect(useSession.getState().focusLayout).toEqual({ ...layout, railOpen: false });
    useSession.setState({ focusLayout: layout });
    fireEvent.click(screen.getByText("readme.txt"));
    expect(useSession.getState().focusLayout).toEqual({ ...layout, railOpen: false });
  });

  it("Workbench 下打开文件不改写 focusLayout.railOpen", async () => {
    const layout = { ...useSession.getState().focusLayout, railOpen: true };
    useSession.setState({ uiMode: "workbench", focusLayout: layout });
    renderTree();
    fireEvent.click(await screen.findByText("readme.txt"));
    expect(useSession.getState().focusLayout.railOpen).toBe(true);
    useSession.setState({ uiMode: "focus" });
  });

  it("不支持的格式行内提示", async () => {
    vi.spyOn(actions, "openProjectFile").mockRejectedValue(new ApiError(422, "no", "unsupported_format"));
    renderTree();
    fireEvent.click(await screen.findByText("scan.nii.gz"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported file format");
  });

  // SDD 14 §7.3 规则 1、10
  it("无候选模态的文件可点击，以文本打开并显示选中态", async () => {
    const openFile = vi.spyOn(actions, "openProjectFile");
    renderTree();
    const row = (await screen.findByText("readme.txt")).closest("button")!;
    expect(row).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(row);
    expect(useSession.getState().document).toEqual({ path: "readme.txt" });
    expect(openFile).not.toHaveBeenCalled();
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  it("文档加载中时行显示 aria-busy 且不重复打开", async () => {
    renderTree();
    const row = (await screen.findByText("readme.txt")).closest("button")!;
    act(() => useSession.setState({ document: { path: "readme.txt" }, documentLoading: true }));
    expect(row).toHaveAttribute("aria-busy", "true");
    const before = useSession.getState().document;
    fireEvent.click(row);
    expect(useSession.getState().document).toBe(before);
  });

  it("读取失败的错误显示在对应行内", async () => {
    renderTree();
    await screen.findByText("readme.txt");
    act(() => useSession.setState({ documentError: { path: "readme.txt", code: "binary" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("Not a text file");
  });

  it("项目目录失效时显示提示而非目录树", () => {
    useProjects.setState({ projects: [{ ...project, status: "missing" }] });
    renderTree();
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(api.projectEntries).not.toHaveBeenCalled();
  });
});
