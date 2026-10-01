// 图谱上传即入库（SDD feats/03 v2.0 §6.1 / §7.8 / §15 v2.0 / D-24 / D-28）：
// - 上传：POST /uploads 携带文件与当前图册，结果与文件级错误可见；
// - 生成描述前须用户确认：确认条出现前后都不自动调 runtime；点「生成描述」才发图；「暂不」隐藏本组；
// - 无模型连接只提示，不给按钮；
// - 详情页保存只提交改动字段，改为可外发须勾选确认并带 egress_consent。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exemplar } from "../../api/atlas";
import { I18nProvider } from "../../i18n";
import { useAtlasUi } from "../../store/atlas";
import { useSession } from "../../store/session";
import { AtlasView } from "./AtlasView";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function ex(id: string, patch: Partial<Exemplar> = {}): Exemplar {
  return {
    exemplar_id: id,
    image_ref: "images/aa/a.png",
    crop_ref: null,
    image_sha256: "a",
    roi: [0, 0, 120, 80],
    geometry: null,
    tags: [],
    tags_raw: [],
    caption: null,
    notes: null,
    description: null,
    describe_status: "pending",
    source_type: "upload",
    source: { filename: `${id}.png` },
    egress: "local-only",
    egress_consent: null,
    status: "active",
    created_at: "2026-10-01T00:00:00+00:00",
    import_batch_id: "b",
    collection: "",
    collection_key: "",
    reviewed: false,
    ...patch,
  };
}

const DESC = { modality: "TEM", subject: "GBM", findings: [], pattern: "", summary: "s", extra: {} };

function mockFetch(handler: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      const res = handler(url, init);
      if (res) return res;
      if (url.includes("/exemplars/") && url.endsWith("/crop")) return new Response(new Uint8Array([1, 2, 3]));
      if (url.startsWith("/api/atlas/tags") || url.startsWith("/api/atlas/collections")) return jsonRes([]);
      return jsonRes([]);
    }),
  );
}

const runtimeCalls = () => calls.filter((c) => c.url.startsWith("/agent-api/v1/atlas/describe"));

function ui() {
  return render(
    <I18nProvider>
      <AtlasView />
    </I18nProvider>,
  );
}

beforeEach(() => {
  calls = [];
  localStorage.setItem("glaux.lang", "zh");
  useAtlasUi.setState({ screen: "list", selectedId: null, collectionFilter: null, describeJob: null, describeDismissed: null });
  useSession.getState().setConnection({ provider: "anthropic", baseUrl: "", model: "claude-test", models: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("上传即入库", () => {
  it("POST /uploads 携带文件与当前图册，显示结果与文件级错误", async () => {
    useAtlasUi.setState({ collectionFilter: { path: "肾脏/EDD", exact: false } });
    mockFetch((url, init) =>
      url === "/api/atlas/uploads" && init?.method === "POST"
        ? jsonRes({
            batch_id: "b1",
            items: [{ exemplar_id: "e1", created: true, file: "a.png" }],
            errors: [{ file: "scan.pdf", code: "NO_FIGURES_FOUND", message: "x" }],
          })
        : undefined,
    );
    ui();
    const input = screen.getByTestId("atlas-upload-input") as HTMLInputElement;
    const files = [new File(["png"], "a.png", { type: "image/png" }), new File(["pdf"], "scan.pdf", { type: "application/pdf" })];
    fireEvent.change(input, { target: { files } });
    const result = await screen.findByTestId("atlas-upload-result");
    expect(result.textContent).toContain("新增 1 条");
    expect(result.textContent).toContain("scan.pdf");
    expect(result.textContent).toContain("未识别到嵌入图");
    const post = calls.find((c) => c.url === "/api/atlas/uploads")!;
    const fd = post.init!.body as FormData;
    expect(fd.getAll("files").map((f) => (f as File).name)).toEqual(["a.png", "scan.pdf"]);
    expect(fd.get("collection")).toBe("肾脏/EDD");
  });
});

describe("生成描述须用户确认（D-28）", () => {
  const pendingList = (url: string) =>
    url.startsWith("/api/atlas/exemplars?") && url.includes("describe_status=pending") ? jsonRes([ex("e1"), ex("e2")]) : undefined;

  it("确认前不调 runtime；确认条写明张数与目标 host；点生成描述后逐条发图并写回", async () => {
    mockFetch((url, init) => {
      if (url.startsWith("/agent-api/v1/atlas/describe")) return jsonRes({ description: DESC });
      if (url.startsWith("/api/atlas/exemplars/") && url.endsWith("/description") && init?.method === "PUT")
        return jsonRes(ex(url.split("/")[4]!, { describe_status: "done" }));
      const m = url.match(/^\/api\/atlas\/exemplars\/(e\d)$/);
      if (m) return jsonRes(ex(m[1]!));
      return pendingList(url);
    });
    ui();
    const bar = await screen.findByTestId("describe-confirm");
    expect(bar.textContent).toContain("2 条案例待描述");
    expect(bar.textContent).toContain("claude-test · api.anthropic.com");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(runtimeCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "生成描述" }));
    await waitFor(() => expect(runtimeCalls()).toHaveLength(2));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/description")).length).toBe(2));
    await waitFor(() => expect(useAtlasUi.getState().describeJob).toMatchObject({ running: false, ok: 2, failed: 0 }));
  });

  it("「暂不」隐藏本组确认条且不发图", async () => {
    mockFetch(pendingList);
    ui();
    await screen.findByTestId("describe-confirm");
    fireEvent.click(screen.getByRole("button", { name: "暂不" }));
    await waitFor(() => expect(screen.queryByTestId("describe-confirm")).toBeNull());
    expect(runtimeCalls()).toHaveLength(0);
  });

  it("无模型连接：只提示配置，不出现生成按钮", async () => {
    useSession.getState().setConnection({ model: "" });
    mockFetch(pendingList);
    ui();
    expect((await screen.findByTestId("describe-need-model")).textContent).toContain("2 条案例待描述");
    expect(screen.queryByTestId("describe-confirm")).toBeNull();
  });
});

describe("批量操作（§7.8 第 8 条）", () => {
  it("批量改为可外发须勾选一次确认，每条带同一批次的 egress_consent；逐条汇报", async () => {
    const patches: { id: string; body: Record<string, unknown> }[] = [];
    mockFetch((url, init) => {
      const m = url.match(/^\/api\/atlas\/exemplars\/(e\d)$/);
      if (m && init?.method === "PATCH") {
        patches.push({ id: m[1]!, body: JSON.parse(String(init.body)) });
        return m[1] === "e2" ? jsonRes({ detail: { code: "NOT_FOUND", message: "e2" } }, 404) : jsonRes(ex(m[1]!));
      }
      if (url.startsWith("/api/atlas/exemplars?") && !url.includes("describe_status")) return jsonRes([ex("e1"), ex("e2")]);
      return undefined;
    });
    ui();
    const cards = await screen.findAllByTestId("exemplar-card");
    cards.forEach((c) => fireEvent.click(c.querySelector("input[type=checkbox]")!));
    const bar = await screen.findByTestId("atlas-batch");
    fireEvent.change(bar.querySelector("select")!, { target: { value: "shareable" } });
    const apply = screen.getByRole("button", { name: "应用" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("batch-consent"));
    fireEvent.click(apply);
    await waitFor(() => expect(patches).toHaveLength(2));
    const batches = patches.map((p) => (p.body.egress_consent as { import_batch_id: string }).import_batch_id);
    expect(new Set(batches).size).toBe(1);
    expect(patches.every((p) => p.body.egress === "shareable")).toBe(true);
    expect((await screen.findByText(/完成 1 条，失败 1 条/)).textContent).toContain("NOT_FOUND");
  });
});

describe("详情编辑（§7.8）", () => {
  it("保存只提交改动字段；改为可外发须勾选确认并带 egress_consent", async () => {
    useAtlasUi.setState({ screen: "detail", selectedId: "e1" });
    const patches: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/api/atlas/exemplars/e1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        return jsonRes(ex("e1", { reviewed: true, tags_raw: ["EDD"], tags: ["edd"], egress: body.egress ?? "local-only" }));
      }
      if (url === "/api/atlas/exemplars/e1") return jsonRes(ex("e1"));
      return undefined;
    });
    ui();
    await screen.findByTestId("exemplar-form");
    const save = screen.getByTestId("exemplar-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("逗号分隔，如：TEM, 电子致密物"), { target: { value: "EDD" } });
    fireEvent.change(screen.getByDisplayValue("仅本地"), { target: { value: "shareable" } });
    expect(save.disabled).toBe(true); // 未勾选外发确认
    fireEvent.click(screen.getByTestId("consent"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(patches).toHaveLength(1));
    const body = patches[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["egress", "egress_consent", "tags"]);
    expect(body.tags).toEqual(["EDD"]);
    expect(body.egress_consent).toMatchObject({ statement_version: "v1" });
  });
});
