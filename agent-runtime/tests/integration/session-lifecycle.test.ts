import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { SessionService } from "../../src/pi/session-service.js";

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
});
