// SDD 13 §7.2 / §7.8：项目目录树按需展开，点击可识别文件经后端校验后打开。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../api/client";
import * as actions from "../data/actions";
import { I18nProvider } from "../i18n";
import { useProjects } from "../store/projects";
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

  it("不支持的格式行内提示，不可识别文件不可点", async () => {
    vi.spyOn(actions, "openProjectFile").mockRejectedValue(new ApiError(422, "no", "unsupported_format"));
    renderTree();
    fireEvent.click(await screen.findByText("scan.nii.gz"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported file format");
    expect(screen.getByText("readme.txt").closest("button")).toBeNull();
  });

  it("项目目录失效时显示提示而非目录树", () => {
    useProjects.setState({ projects: [{ ...project, status: "missing" }] });
    renderTree();
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(api.projectEntries).not.toHaveBeenCalled();
  });
});
