// 导入向导（SDD feats/03 §6.1 / §13 / D-16 · 验收 §15）：
// - NO_FIGURES_FOUND → 呈现"手动上传"引导，不进入下一步；
// - shareable 未勾选协议不能提交；勾选后请求体带 egress_consent（statement_version / import_batch_id）；
// - local-only 不带 consent；候选引用 import_id + figure_index。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { CONSENT_STATEMENT_VERSION, ImportWizard } from "./ImportWizard";

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SESSION = {
  import_id: "imp-1",
  source_type: "web",
  origin: { url: "https://example.org/p" },
  figures: [
    { index: 0, width: 200, height: 100, caption: "Fig 1. EDD", nearby: ["para"], locator: {} },
    { index: 1, width: 300, height: 100, caption: "Fig 2", nearby: [], locator: {} },
  ],
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

function ui() {
  return render(
    <I18nProvider>
      <ImportWizard />
    </I18nProvider>,
  );
}

async function goToStep3WithOneRegion() {
  ui();
  fireEvent.click(screen.getByRole("tab", { name: "Web page URL" }));
  fireEvent.change(screen.getByLabelText("Web page URL"), { target: { value: "https://example.org/p" } });
  fireEvent.click(screen.getByRole("button", { name: "Extract figures" }));
  await screen.findByText(/2 candidate figures/);
  // 只保留第一张
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  // 步骤 2：整图作为一个区域（jsdom 不解码图片 → 用 onload 触发不到；直接构造 Image.onload）
  fireEvent.click(screen.getByRole("button", { name: "Use whole image" }));
  await screen.findByLabelText("tags 1");
  fireEvent.change(screen.getByLabelText("tags 1"), { target: { value: "TEM, EDD" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Book / site name"), { target: { value: "Example site" } });
}

describe("ImportWizard", () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ connection: { ...useSession.getState().connection, model: "" } });
    // jsdom 的 Image 不加载：模拟 onload 立即触发并给出自然尺寸
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 200;
        naturalHeight = 100;
        onload: null | (() => void) = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("NO_FIGURES_FOUND → 引导手动上传，不能进入下一步", async () => {
    mockFetch(() => jsonRes({ detail: { code: "NO_FIGURES_FOUND", message: "no figures" } }, 422));
    ui();
    fireEvent.click(screen.getByRole("tab", { name: "Web page URL" }));
    fireEvent.change(screen.getByLabelText("Web page URL"), { target: { value: "https://example.org/scan" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract figures" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Upload a screenshot instead/);
    expect(screen.getByText("Upload image manually")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("FETCH_BLOCKED → 提示地址不允许", async () => {
    mockFetch(() => jsonRes({ detail: { code: "FETCH_BLOCKED", message: "private" } }, 400));
    ui();
    fireEvent.click(screen.getByRole("tab", { name: "Web page URL" }));
    fireEvent.change(screen.getByLabelText("Web page URL"), { target: { value: "http://10.0.0.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract figures" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not allowed/);
  });

  it("shareable 未勾选不能提交；勾选后请求体带 egress_consent", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/atlas/imports/url")) return jsonRes(SESSION);
      if (url.endsWith("/atlas/tags?status=all")) return jsonRes([]);
      if (url.endsWith("/atlas/exemplars") && init?.method === "POST") return jsonRes([{ exemplar_id: "ex-1", created: true }]);
      return jsonRes({ detail: { code: "NOT_FOUND", message: url } }, 404);
    });
    await goToStep3WithOneRegion();
    const submit = screen.getByTestId("submit");
    expect(submit).toBeEnabled(); // local-only 无需勾选
    fireEvent.click(screen.getByRole("radio", { name: "shareable" }));
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Tick the confirmation/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("consent"));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await screen.findByText(/Imported 1 new, 0 already present/);

    const create = calls.find((c) => c.url.endsWith("/atlas/exemplars") && c.init?.method === "POST")!;
    const body = JSON.parse(String(create.init!.body)) as {
      import_batch_id: string;
      items: {
        egress: string;
        egress_consent: { confirmed_at: string; import_batch_id: string; statement_version: string };
        roi: number[];
        tags: string[];
        source_type: string;
        source: Record<string, unknown>;
        import_id: string;
        figure_index: number;
        caption: string | null;
      }[];
    };
    expect(body.items).toHaveLength(1);
    const it0 = body.items[0]!;
    expect(it0.egress).toBe("shareable");
    expect(it0.egress_consent.statement_version).toBe(CONSENT_STATEMENT_VERSION);
    expect(it0.egress_consent.import_batch_id).toBe(body.import_batch_id);
    expect(it0.egress_consent.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(it0.roi).toEqual([0, 0, 200, 100]);
    expect(it0.tags).toEqual(["TEM", "EDD"]);
    expect(it0.source_type).toBe("web");
    expect(it0.source).toMatchObject({ url: "https://example.org/p", name: "Example site" });
    expect(it0).toMatchObject({ import_id: "imp-1", figure_index: 0, caption: "Fig 1. EDD" });
    // 未配模型 → 不调 runtime describe
    expect(calls.some((c) => c.url.includes("/agent-api/"))).toBe(false);
  });

  it("local-only 提交：egress_consent 为 null", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/atlas/imports/url")) return jsonRes(SESSION);
      if (url.endsWith("/atlas/tags?status=all")) return jsonRes([]);
      if (url.endsWith("/atlas/exemplars") && init?.method === "POST") return jsonRes([{ exemplar_id: "ex-1", created: false }]);
      return jsonRes({ detail: { code: "NOT_FOUND", message: url } }, 404);
    });
    await goToStep3WithOneRegion();
    fireEvent.click(screen.getByTestId("submit"));
    await screen.findByText(/Imported 0 new, 1 already present/);
    const create = calls.find((c) => c.url.endsWith("/atlas/exemplars") && c.init?.method === "POST")!;
    const body = JSON.parse(String(create.init!.body)) as { items: { egress: string; egress_consent: unknown }[] };
    expect(body.items[0]).toMatchObject({ egress: "local-only", egress_consent: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeEnabled());
  });
});
