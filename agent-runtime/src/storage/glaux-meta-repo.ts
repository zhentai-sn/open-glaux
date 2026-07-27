import { DatabaseSync } from "node:sqlite";

import {
  PERMISSION_MODES,
  SESSION_STATUSES,
  type GlauxSessionMeta,
  type PermissionMode,
  type SessionStatus,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";

interface MetaRow {
  session_id: string;
  title: string;
  status: string;
  permission_mode: string;
  created_at: string;
  updated_at: string;
}

function toMeta(row: MetaRow): GlauxSessionMeta {
  if (
    !SESSION_STATUSES.includes(row.status as SessionStatus) ||
    !PERMISSION_MODES.includes(row.permission_mode as PermissionMode)
  ) {
    throw new RuntimeError("storage_error", "Invalid Glaux session metadata.", 500);
  }
  return {
    session_id: row.session_id,
    title: row.title,
    status: row.status as SessionStatus,
    permission_mode: row.permission_mode as PermissionMode,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class GlauxMetaRepo {
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode=WAL");
    this.database.exec("PRAGMA synchronous=FULL");
    this.database.exec("PRAGMA busy_timeout=5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS glaux_session_meta (
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
  }

  close(): void {
    this.database.close();
  }

  get(sessionId: string): GlauxSessionMeta | undefined {
    const row = this.database
      .prepare("SELECT * FROM glaux_session_meta WHERE session_id = ?")
      .get(sessionId) as MetaRow | undefined;
    return row ? toMeta(row) : undefined;
  }

  list(status?: SessionStatus): GlauxSessionMeta[] {
    const rows = (
      status
        ? this.database
            .prepare(
              "SELECT * FROM glaux_session_meta WHERE status = ? ORDER BY updated_at DESC",
            )
            .all(status)
        : this.database
            .prepare("SELECT * FROM glaux_session_meta ORDER BY updated_at DESC")
            .all()
    ) as unknown as MetaRow[];
    return rows.map(toMeta);
  }

  create(input: {
    sessionId: string;
    title: string;
    permissionMode: PermissionMode;
    now?: string;
  }): GlauxSessionMeta {
    const now = input.now ?? new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO glaux_session_meta
          (session_id, title, status, permission_mode, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?)`,
      )
      .run(input.sessionId, input.title, input.permissionMode, now, now);
    return this.get(input.sessionId)!;
  }

  update(
    sessionId: string,
    patch: Partial<Pick<GlauxSessionMeta, "title" | "status" | "permission_mode">>,
  ): GlauxSessionMeta {
    const current = this.get(sessionId);
    if (!current) {
      throw new RuntimeError("session_not_found", "Session not found.", 404);
    }
    const next = {
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      permission_mode: patch.permission_mode ?? current.permission_mode,
      updated_at: new Date().toISOString(),
    };
    this.database
      .prepare(
        `UPDATE glaux_session_meta
         SET title = ?, status = ?, permission_mode = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(
        next.title,
        next.status,
        next.permission_mode,
        next.updated_at,
        sessionId,
      );
    return this.get(sessionId)!;
  }

  delete(sessionId: string): void {
    this.database
      .prepare("DELETE FROM glaux_session_meta WHERE session_id = ?")
      .run(sessionId);
  }
}
