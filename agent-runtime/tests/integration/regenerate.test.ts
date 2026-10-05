import { contentText, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  TEST_CONNECTION,
  createRuntimeFixture,
  waitFor,
} from "../helpers/runtime-fixture.js";

describe("latest answer regeneration", () => {
  it("uses Pi tree navigation and exposes only the new active branch", async () => {
    const fixture = await createRuntimeFixture([
      [fauxAssistantMessage("old answer")],
      [fauxAssistantMessage("new answer")],
    ]);
    const sessionId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "same question",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);
      await waitFor(() => fixture.registry.getPhase(sessionId) === "idle");

      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "regenerate",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages).toHaveLength(2);
      expect(view.messages[0]?.role).toBe("user");
      expect(
        view.messages[1]?.role === "assistant"
          ? contentText(view.messages[1].content)
          : "",
      ).toBe("new answer");

      const session = await fixture.sessions.openSession(sessionId);
      try {
        const allMessages = (await session.getEntries()).filter(
          (entry) => entry.type === "message",
        );
        expect(
          allMessages.filter(
            (entry) =>
              entry.message.role === "assistant" &&
              contentText(entry.message.content) === "old answer",
          ),
        ).toHaveLength(1);
      } finally {
        await fixture.sessions.closeSession(session);
      }
    } finally {
      await fixture.close();
    }
  });

  it("regenerates an answer that ended after tool calls, also after a runtime restart", async () => {
    const toolTurn = () => [
      fauxAssistantMessage(fauxToolCall("view_current_image", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("consult_atlas", { query: "x" }), { stopReason: "toolUse" }),
    ];
    const first = await createRuntimeFixture([
      [...toolTurn(), fauxAssistantMessage("old answer")],
    ]);
    const sessionId = crypto.randomUUID();
    await first.sessions.createSession({ session_id: sessionId });
    await first.commands.accept(sessionId, {
      command_id: crypto.randomUUID(),
      type: "prompt",
      content: "look at this",
      connection: TEST_CONNECTION,
    });
    await first.registry.waitForIdle(sessionId);
    await first.close();

    // 重启：新 SessionService / HarnessRegistry 读同一数据目录。
    const fixture = await createRuntimeFixture(
      [[...toolTurn(), fauxAssistantMessage("new answer")]],
      { dataDir: first.dataDir },
    );
    try {
      const before = await fixture.sessions.getSession(sessionId);
      expect(before.messages.map((message) => message.role)).toEqual([
        "user", "assistant", "toolResult", "assistant", "toolResult", "assistant",
      ]);

      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "regenerate",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages.filter((message) => message.role === "user")).toHaveLength(1);
      const last = view.messages.at(-1);
      expect(last?.role === "assistant" ? contentText(last.content) : "").toBe("new answer");
      expect(
        view.messages.some(
          (message) => message.role === "assistant" && contentText(message.content) === "old answer",
        ),
      ).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("rejects regenerate when the active path has no assistant answer", async () => {
    const fixture = await createRuntimeFixture([[]]);
    const sessionId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "regenerate",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);
      await waitFor(async () => {
        const session = await fixture.sessions.openSession(sessionId);
        try {
          return (await session.getEntries()).some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === "glaux.command.settled" &&
              (entry.data as { code?: string }).code === "message_not_regenerable",
          );
        } finally {
          await fixture.sessions.closeSession(session);
        }
      });
    } finally {
      await fixture.close();
    }
  });

  it("restores the previous active leaf when regeneration fails", async () => {
    const fixture = await createRuntimeFixture([
      [fauxAssistantMessage("stable answer")],
      [
        fauxAssistantMessage("provider failed", {
          stopReason: "error",
          errorMessage: "controlled fake failure",
        }),
      ],
    ]);
    const sessionId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "keep this question",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);

      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "regenerate",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages).toHaveLength(2);
      expect(
        view.messages[1]?.role === "assistant"
          ? contentText(view.messages[1].content)
          : "",
      ).toBe("stable answer");
    } finally {
      await fixture.close();
    }
  });
});
