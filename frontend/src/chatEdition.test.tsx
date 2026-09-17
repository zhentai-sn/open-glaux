import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_GLAUX_EDITION", "chat");
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("renders only chat without backend requests, even with old workspace preferences", async () => {
  localStorage.setItem("glaux.uiMode.v1", "workbench");
  const { useSession } = await import("./store/session");
  const { useAgentSessions } = await import("./store/agentSessions");
  useAgentSessions.setState({ initialize: vi.fn(async () => {}), loading: false });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { App } = await import("./App");
  const { I18nProvider } = await import("./i18n");
  render(<I18nProvider><App /></I18nProvider>);
  expect(screen.getByText(/Chat preview/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Instruct the agent…" })).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(document.querySelector(".mode-switch, .focus-side, .focus-cards, .focus-ctx")).toBeNull();
  expect(useSession.getState().uiMode).toBe("focus");
  useSession.getState().setUiMode("workbench");
  fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: "r" });
  expect(useSession.getState().uiMode).toBe("focus");
  expect(useSession.getState().tool).toBe("cursor");
  const { SHORTCUT_ROWS } = await import("./keys/globalKeys");
  expect(SHORTCUT_ROWS.map((r) => r.label)).toEqual(["sc_left", "sc_sheet"]);
  expect(fetch).not.toHaveBeenCalled();
});
