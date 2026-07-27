import { afterEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi, AgentRuntimeError } from "./client";

describe("Agent Runtime client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the stable agent-api prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          adapter: "ok",
          pi: "ok",
          storage: "ok",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await agentRuntimeApi.health();

    expect(fetchMock).toHaveBeenCalledWith(
      "/agent-api/v1/health",
      expect.any(Object),
    );
  });

  it("maps a safe error without retaining the submitted credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "provider_auth_failed",
            message: "Provider authentication failed.",
            trace_id: "trace-safe",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const credential = "frontend-secret-credential";

    let caught: unknown;
    try {
      await agentRuntimeApi.command(crypto.randomUUID(), {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "hello",
        connection: {
          provider: "anthropic",
          model: "model",
          credential,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentRuntimeError);
    expect(JSON.stringify(caught)).not.toContain(credential);
  });
});
