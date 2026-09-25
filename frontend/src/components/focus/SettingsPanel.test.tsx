// 设置面板（SDD feats/01 v1.7 D23）：分区导航切换内容；连接分区嵌入表单；外观分区写主题与界面语言。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { useTheme } from "../../store/theme";

vi.mock("../agent/ConnectionConfig", () => ({
  ConnectionConfig: ({ variant }: { variant?: string }) => <div data-testid="cfg-form">{variant}</div>,
}));

import { SettingsPanel } from "./SettingsPanel";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
  useTheme.getState().setTheme("dark");
  render(<I18nProvider><SettingsPanel /></I18nProvider>);
});

it("缺省打开「模型与连接」分区，表单以面板形态嵌入", () => {
  expect(screen.getByRole("button", { name: /Model & connection/ })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Model & connection" })).toBeInTheDocument();
  expect(screen.getByTestId("cfg-form")).toHaveTextContent("panel");
});

it("外观分区：切换主题写 useTheme 与 <html data-theme>", () => {
  fireEvent.click(screen.getByRole("button", { name: /Appearance/ }));
  expect(screen.queryByTestId("cfg-form")).toBeNull();
  expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("radio", { name: "Light" }));
  expect(useTheme.getState().theme).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
});

it("外观分区：切换界面语言即时生效", () => {
  fireEvent.click(screen.getByRole("button", { name: /Appearance/ }));
  fireEvent.click(screen.getByRole("radio", { name: "中文" }));
  expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "中文" })).toHaveAttribute("aria-checked", "true");
});
