/** SDD 00 §9.1、SDD 13 §7.4 规则 12：置顶的持久化与旧库补列。 */
import { DatabaseSync } from "node:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GlauxMetaRepo } from "../../src/storage/glaux-meta-repo.js";

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "glaux-meta-pinned-"));
  return join(dir, "glaux-meta.sqlite");
}

describe("GlauxMetaRepo · pinned", () => {
  it("新库自带 pinned 列，默认不置顶", async () => {
    const repo = new GlauxMetaRepo(await databasePath());
    try {
      const meta = repo.create({ sessionId: "s1", title: "t", permissionMode: "controlled" });
      expect(meta.pinned).toBe(false);
      expect(repo.update("s1", { pinned: true }).pinned).toBe(true);
      // 其他字段不动
      expect(repo.get("s1")).toMatchObject({ title: "t", status: "active", pinned: true });
      expect(repo.update("s1", { pinned: false }).pinned).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("旧库缺 pinned 列时补列，已有行读作未置顶", async () => {
    const path = await databasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE glaux_session_meta (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
        status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
        permission_mode TEXT NOT NULL CHECK(
          permission_mode IN ('observe', 'suggest', 'controlled', 'autonomous')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    legacy
      .prepare(
        `INSERT INTO glaux_session_meta (session_id, title, status, permission_mode, created_at, updated_at)
         VALUES ('legacy', '旧会话', 'active', 'controlled', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      )
      .run();
    legacy.close();

    const repo = new GlauxMetaRepo(path);
    try {
      expect(repo.get("legacy")).toMatchObject({ title: "旧会话", pinned: false });
      expect(repo.update("legacy", { pinned: true }).pinned).toBe(true);
      const columns = (repo.database.prepare("PRAGMA table_info(glaux_session_meta)").all() as { name: string }[])
        .map((column) => column.name);
      expect(columns).toContain("pinned");
    } finally {
      repo.close();
    }
  });
});
