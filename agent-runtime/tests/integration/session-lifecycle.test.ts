import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { MAX_TOOL_OUTPUT_TEXT, SessionService, TOOL_TIMING_ENTRY } from "../../src/pi/session-service.js";
import { ANNOTATION_PROPOSED_DETAILS_KIND } from "../../src/pi/tools/propose-annotation.js";

async function createService() {
  const dataDir = await mkdtemp(join(tmpdir(), "glaux-session-service-"));
  const service = new SessionService({
    workspaceDir: dataDir,
    piDatabasePath: join(dataDir, "pi-sessions.sqlite"),
    metaDatabasePath: join(dataDir, "glaux-meta.sqlite"),
  });
  await service.initialize();
  return { dataDir, service };
}

describe("SessionService lifecycle", () => {
  it("keeps at most one empty session and isolates 20 populated sessions", async () => {
    const { service } = await createService();

    try {
      const emptyId = crypto.randomUUID();
      const first = await service.createSession({ session_id: emptyId });
      const reused = await service.createSession({ session_id: crypto.randomUUID() });
      expect(reused.view.session_id).toBe(first.view.session_id);

      for (let index = 0; index < 20; index += 1) {
        const current = index === 0 ? first : await service.createSession({
          session_id: crypto.randomUUID(),
        });
        const session = await service.openSession(current.view.session_id);
        await session.appendMessage({
          role: "user",
          content: `message-${index}`,
          timestamp: Date.now(),
        });
        await service.closeSession(session);
      }

      const listed = await service.listSessions("active");
      expect(listed).toHaveLength(20);
      const views = await Promise.all(
        listed.map((item) => service.getSession(item.session_id)),
      );
      expect(
        new Set(
          views.map((view) => {
            const firstMessage = view.messages[0];
            return firstMessage?.role === "user" ? firstMessage.content : "";
          }),
        ).size,
      ).toBe(20);
    } finally {
      await service.close();
    }
  });

  it("persists metadata separately and supports rename, archive, restore and delete", async () => {
    const { dataDir, service } = await createService();
    const sessionId = crypto.randomUUID();

    try {
      await service.createSession({
        session_id: sessionId,
        title: "Initial",
        permission_mode: "controlled",
      });
      const archived = await service.patchSession(sessionId, {
        title: "Renamed",
        status: "archived",
        permission_mode: "suggest",
        provider: "anthropic",
        model: "test-model",
      });
      expect(archived).toMatchObject({
        title: "Renamed",
        status: "archived",
        permission_mode: "suggest",
        provider: "anthropic",
        model: "test-model",
      });

      await service.patchSession(sessionId, { status: "active" });
      expect((await service.getSession(sessionId)).status).toBe("active");

      const database = new DatabaseSync(join(dataDir, "glaux-meta.sqlite"), {
        readOnly: true,
      });
      const columns = database
        .prepare("PRAGMA table_info(glaux_session_meta)")
        .all()
        .map((row) => (row as { name: string }).name);
      database.close();
      expect(columns).toEqual([
        "session_id",
        "title",
        "status",
        "permission_mode",
        "created_at",
        "updated_at",
      ]);

      await service.deleteSession(sessionId);
      await expect(service.getSession(sessionId)).rejects.toMatchObject({
        code: "session_not_found",
      });
    } finally {
      await service.close();
    }

    expect((await readFile(join(dataDir, "glaux-meta.sqlite"))).length).toBeGreaterThan(0);
  });

  it("keeps tool output text and durations in snapshots, card details only for successful results", async () => {
    const { service } = await createService();
    const sessionId = crypto.randomUUID();

    try {
      await service.createSession({ session_id: sessionId });
      const session = await service.openSession(sessionId);
      await session.appendMessage({
        role: "toolResult",
        toolCallId: "proposal-ok",
        toolName: "propose_annotation",
        content: [
          { type: "text", text: "x".repeat(MAX_TOOL_OUTPUT_TEXT + 10) },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
        details: {
          kind: ANNOTATION_PROPOSED_DETAILS_KIND,
          payload: {
            annotation_id: "ann-1",
            image_id: "natural_cat",
            label: "小猫",
            primitive: { kind: "bbox", x0: 1, y0: 2, x1: 30, y1: 40 },
            z: null,
            seq: 1,
          },
        },
        isError: false,
        timestamp: Date.now(),
      });
      await session.appendMessage({
        role: "toolResult",
        toolCallId: "proposal-error",
        toolName: "propose_annotation",
        content: [{ type: "text", text: "failed: api_key=sk-secret" }],
        details: { kind: ANNOTATION_PROPOSED_DETAILS_KIND },
        isError: true,
        timestamp: Date.now(),
      });
      await session.appendCustomEntry(TOOL_TIMING_ENTRY, { tool_call_id: "proposal-ok", duration_ms: 42 });
      await service.closeSession(session);

      const toolResults = (await service.getSession(sessionId)).messages.filter(
        (message) => (message as { role?: string }).role === "toolResult",
      ) as Array<{ content?: { type: string; text?: string }[]; details?: { kind?: string; payload?: unknown }; duration_ms?: number }>;
      expect(toolResults).toHaveLength(2);
      expect(toolResults[0]?.details).toMatchObject({
        kind: ANNOTATION_PROPOSED_DETAILS_KIND,
        payload: { annotation_id: "ann-1", image_id: "natural_cat" },
      });
      // 只留文本，截断到上限；图像块不进快照
      expect(toolResults[0]?.content).toEqual([{ type: "text", text: `${"x".repeat(MAX_TOOL_OUTPUT_TEXT)}…` }]);
      expect(toolResults[0]?.duration_ms).toBe(42);
      // 失败结果保留输出（已脱敏），不保留卡片 details
      expect(toolResults[1]?.details).toBeUndefined();
      expect(toolResults[1]?.content?.[0]?.text).not.toContain("sk-secret");
      expect(toolResults[1]?.duration_ms).toBeUndefined();
    } finally {
      await service.close();
    }
  });
});
