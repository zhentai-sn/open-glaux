// Explorer 三态与数据源驱动（SDD 08 §15 前端）：空态不发数据请求、failed 与空严格区分、
// 模态切换器可见性来自 /datasources、通用图像标签为中性文案、最近使用本地持久化。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataSource, ObjectMeta, Modality } from "../api/types";
import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";
import { RECENT_KEY } from "../data/recent";
import { dsFields, objectMeta } from "../test/fixtures";

// 数据端点全部打桩：空态的核心断言就是「这些一个都没被调到」。
// vi.mock 会被提升到文件顶部，故桩必须放进 vi.hoisted，否则工厂里读到的是未初始化的 TDZ 变量。
const spies = vi.hoisted(() => ({
  objects: vi.fn(async () => []),
  images: vi.fn(async () => []),
  naturalImages: vi.fn(async () => []),
  volumes: vi.fn(async () => []),
  slides: vi.fn(async () => []),
  taskRun: vi.fn(async () => ({ metrics: {}, primitives: [], provenance: {} })),
  datasources: vi.fn(async () => []),
  loadSamples: vi.fn(async () => []),
  uploadImages: vi.fn(),
  capabilities: vi.fn(async () => []),
  models: vi.fn(async () => []),
  removeDatasource: vi.fn(async () => ({ ok: true, removed: "x" })),
  importDatasource: vi.fn(),
}));
vi.mock("../api/client", () => ({ api: spies, ApiError: class extends Error {} }));

import { ExplorerView } from "./SideBar";

const ds = (id: string, modality: Modality, status: DataSource["status"] = "active"): DataSource => ({
  id,
  name: id,
  modality,
  root: `/r/${id}`,
  origin: "imported",
  calibration: {},
  status,
  ...dsFields(modality),
});

const img = (id: string, modality: Modality): ObjectMeta => objectMeta({ id, modality });

function ui() {
  return render(
    <I18nProvider>
      <ExplorerView />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
  for (const fn of Object.values(spies)) (fn as ReturnType<typeof vi.fn>).mockClear?.();
  useSession.setState({
    modality: "carotid_imt",
    tasks: [],
    objects: {},
    focus: null,
    datasources: [],
    dsState: "ready",
    recentItems: [],
  });
});

describe("Explorer 三态（SDD 08 §11）", () => {
  it("无 active 数据源 → 空态卡，且不发任何数据请求", () => {
    ui();
    expect(screen.getByText("No data yet")).toBeTruthy();
    expect(screen.getByText("Drop images here")).toBeTruthy();
    for (const name of ["objects", "images", "naturalImages", "volumes", "slides", "taskRun"] as const) {
      expect(spies[name]).not.toHaveBeenCalled();
    }
  });

  it("只有 needs_calibration / empty 源时仍是空态（判据是 active，不是「有条目」）", () => {
    useSession.setState({
      datasources: [ds("a", "pathology", "needs_calibration"), ds("b", "ct_abdomen", "empty")],
    });
    ui();
    expect(screen.getByText("No data yet")).toBeTruthy();
  });

  it("failed 渲染错误与重试，不渲染空态文案", () => {
    useSession.setState({ dsState: "failed" });
    ui();
    expect(screen.getByText(/Could not load data sources/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No data yet")).toBeNull();
  });

  it("loading 显骨架，不显任何文案（避免闪烁）", () => {
    useSession.setState({ dsState: "loading" });
    const { container } = ui();
    expect(container.querySelector(".exp-skel")).toBeTruthy();
    expect(screen.queryByText("No data yet")).toBeNull();
  });
});

describe("模态切换器可见性来自数据源（SDD 08 D-1）", () => {
  it("只有一个 active 模态 → 不渲染切换器", () => {
    useSession.setState({
      datasources: [ds("a", "carotid_imt")],
      objects: { carotid_imt: [img("t1", "carotid_imt")] },
    });
    ui();
    expect(screen.queryByRole("button", { name: "General images" })).toBeNull();
  });

  it("两个 active 模态 → 渲染两个候选；标签取自数据源 label_key（D-22），通用图像可选中", () => {
    useSession.setState({
      modality: "natural_image",
      datasources: [ds("a", "pathology"), ds("b", "natural_image")],
      objects: { natural_image: [img("nat-1", "natural_image")] },
      tasks: [
        {
          task: "nuclei_detection",
          modality: "pathology",
          label: { zh: "细胞核", en: "Nuclei" },
          tools: [],
          metrics: [],
          capabilities: [],
        },
      ] as never,
    });
    ui();
    const general = screen.getByRole("button", { name: "General images" });
    expect(general.className).toContain("on"); // 选中通用图像时该 tab 高亮（修复旧的「四个都不亮」）
    // 标签来自数据源而非任务注册表：病理显示模态标签，不再显示任务名
    expect(screen.getByRole("button", { name: "Pathology slides" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuclei" })).toBeNull();
  });

  it("任务注册表里有、但无数据源的模态不出现", () => {
    useSession.setState({
      datasources: [ds("a", "pathology"), ds("b", "natural_image")],
      tasks: [
        {
          task: "far_wall_cca_imt",
          modality: "carotid_imt",
          label: { zh: "颈动脉", en: "Carotid" },
          tools: [],
          metrics: [],
          capabilities: [],
        },
      ] as never,
    });
    ui();
    expect(screen.queryByRole("button", { name: /Carotid/ })).toBeNull();
  });
});

describe("最近使用（SDD 08 §9.4）", () => {
  it("渲染最近项并可点击打开；不存在的对象被静默剔除", () => {
    useSession.setState({
      datasources: [ds("b", "natural_image")],
      objects: { natural_image: [img("nat-1", "natural_image")] },
      recentItems: [
        { modality: "natural_image", kind: "image", id: "nat-1", label: "nat-1", at: "2026-08-30T00:00:00Z" },
        { modality: "natural_image", kind: "image", id: "gone", label: "gone", at: "2026-08-29T00:00:00Z" },
      ],
    });
    ui();
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.queryByText("gone")).toBeNull(); // 已不存在 → 剔除
    expect(useSession.getState().recentItems.map((i) => i.id)).toEqual(["nat-1"]);
  });

  it("对应列表尚未加载时保留记录，不当作失效项删掉", () => {
    // 回归守卫：启动期通用图像还没拉回来（objects 缺该键），若把「未加载」当「不存在」，
    // 有效的最近记录会被永久剔除并写回 localStorage。走查时就是这么丢的。
    useSession.setState({
      datasources: [ds("a", "carotid_imt")],
      objects: { carotid_imt: [img("t1", "carotid_imt")] }, // natural_image 缺键 = 尚未加载
      recentItems: [
        { modality: "natural_image", kind: "image", id: "nat-1", label: "nat-1", at: "2026-08-31T00:00:00Z" },
      ],
    });
    ui();
    expect(screen.getByText("nat-1")).toBeTruthy();
    expect(useSession.getState().recentItems).toHaveLength(1);
  });

  it("localStorage 里是非法 JSON 时正常渲染且最近使用为空", () => {
    localStorage.setItem(RECENT_KEY, "{not json");
    useSession.setState({
      datasources: [ds("a", "carotid_imt")],
      objects: { carotid_imt: [img("t1", "carotid_imt")] },
      recentItems: [],
    });
    ui();
    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.getByRole("button", { name: /^objects$/i })).toBeTruthy();
  });
});

describe("导入入口", () => {
  it("有数据时头部有「导入数据」按钮，点击展开导入面板", () => {
    useSession.setState({
      datasources: [ds("a", "carotid_imt")],
      objects: { carotid_imt: [img("t1", "carotid_imt")] },
    });
    ui();
    expect(screen.queryByText("Drop images here")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import data" }));
    expect(screen.getByText("Drop images here")).toBeTruthy();
  });

  it("空态里点「加载示例数据」调后端", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Load sample data" }));
    expect(spies.loadSamples).toHaveBeenCalled();
  });
});
