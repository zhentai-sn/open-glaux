import { readdir, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionService } from "../../src/pi/session-service.js";

describe("session storage credential boundary", () => {
  it("does not persist a credential in either SQLite database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "glaux-storage-leak-"));
    const service = new SessionService({
      workspaceDir: dataDir,
      piDatabasePath: join(dataDir, "pi-sessions.sqlite"),
      metaDatabasePath: join(dataDir, "glaux-meta.sqlite"),
    });
    const credential = "glaux-test-credential-7f41a65d";

    try {
      await service.initialize();
      const created = await service.createSession({
        session_id: crypto.randomUUID(),
        title: "Safe title",
      });
      const session = await service.openSession(created.view.session_id);
      await session.appendCustomEntry("glaux.command.accepted", {
        command_id: crypto.randomUUID(),
        digest: "sha256:safe",
      });
      await service.closeSession(session);
    } finally {
      await service.close();
    }

    const files = await readdir(dataDir);
    for (const file of files) {
      const bytes = await readFile(join(dataDir, file));
      expect(bytes.includes(Buffer.from(credential)), file).toBe(false);
    }
  });
});
