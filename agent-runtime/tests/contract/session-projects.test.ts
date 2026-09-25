import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../src/transport/server.js";
import { createRuntimeFixture } from "../helpers/runtime-fixture.js";

/** SDD 13 §7.6、§9.5：会话创建时绑定项目，绑定存 Pi metadata。 */
describe("session project binding", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function setup() {
    const fixture = await createRuntimeFixture();
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    cleanups.push(async () => {
      await server.close();
      await fixture.close();
    });
    return { fixture, server, sessions: fixture.sessions };
  }

  async function addMessage(
    sessions: Awaited<ReturnType<typeof setup>>["sessions"],
    sessionId: string,
  ) {
    const session = await sessions.openSession(sessionId);
    await session.appendMessage({ role: "user", content: "hi", timestamp: Date.now() });
    await sessions.closeSession(session);
  }

  it("reuses an empty session only within the same project", async () => {
    const { sessions } = await setup();

    const a = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: "proj-a" });
    const b = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: "proj-b" });
    const none = await sessions.createSession({ session_id: crypto.randomUUID() });
    expect([a.created, b.created, none.created]).toEqual([true, true, true]);
    expect(a.view.project_id).toBe("proj-a");
    expect(b.view.project_id).toBe("proj-b");
    expect(none.view.project_id).toBeNull();

    const againA = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: "proj-a" });
    expect(againA).toMatchObject({ created: false, view: { session_id: a.view.session_id } });
    const againNone = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: null });
    expect(againNone).toMatchObject({ created: false, view: { session_id: none.view.session_id } });

    // 已有消息的会话不再复用：同项目得到新的空会话。
    await addMessage(sessions, a.view.session_id);
    const fresh = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: "proj-a" });
    expect(fresh.created).toBe(true);
    expect(fresh.view.project_id).toBe("proj-a");
  });

  it("rejects the same session id with a different project id", async () => {
    const { sessions } = await setup();
    const sessionId = crypto.randomUUID();
    await sessions.createSession({ session_id: sessionId, project_id: "proj-a" });

    const same = await sessions.createSession({ session_id: sessionId, project_id: "proj-a" });
    expect(same).toMatchObject({ created: false, view: { project_id: "proj-a" } });
    await expect(
      sessions.createSession({ session_id: sessionId, project_id: "proj-b" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict", statusCode: 409 });
    await expect(
      sessions.createSession({ session_id: sessionId }),
    ).rejects.toMatchObject({ code: "idempotency_conflict", statusCode: 409 });
  });

  it("writes Pi metadata only for bound sessions and reads legacy sessions as unowned", async () => {
    const { fixture, sessions } = await setup();
    const bound = crypto.randomUUID();
    const unowned = crypto.randomUUID();
    await sessions.createSession({ session_id: bound, project_id: "proj-a" });
    await addMessage(sessions, bound);
    await sessions.createSession({ session_id: unowned });
    await addMessage(sessions, unowned);

    // 升级前的会话：Pi 侧无 metadata，只有 companion 行。
    const legacy = crypto.randomUUID();
    const session = await sessions.piRepo.create({ id: legacy, cwd: sessions.env.cwd });
    await sessions.closeSession(session);
    sessions.metaRepo.create({ sessionId: legacy, title: "Legacy", permissionMode: "controlled" });

    const database = new DatabaseSync(join(fixture.dataDir, "pi-sessions.sqlite"));
    try {
      const rows = database
        .prepare("SELECT id, metadata, cwd FROM sessions")
        .all() as Array<{ id: string; metadata: string | null; cwd: string }>;
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(JSON.parse(byId.get(bound)!.metadata!)).toEqual({ glaux_project_id: "proj-a" });
      expect(byId.get(unowned)!.metadata).toBeNull();
      // cwd 不承载项目语义（D-5）。
      expect(byId.get(bound)!.cwd).toBe(byId.get(unowned)!.cwd);
    } finally {
      database.close();
    }

    expect((await sessions.getSession(legacy)).project_id).toBeNull();
    const listed = await sessions.listSessions("active");
    expect(Object.fromEntries(listed.map((item) => [item.session_id, item.project_id]))).toEqual({
      [bound]: "proj-a",
      [unowned]: null,
      [legacy]: null,
    });
    // companion 表不增列（SDD 00 D-018）。
    const meta = new DatabaseSync(join(fixture.dataDir, "glaux-meta.sqlite"));
    try {
      const columns = meta.prepare("PRAGMA table_info(glaux_session_meta)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("project_id");
    } finally {
      meta.close();
    }
  });

  it("lists sessions with a single Pi list call and drops orphaned companion rows", async () => {
    const { sessions } = await setup();
    for (const projectId of ["proj-a", "proj-b", null]) {
      const created = await sessions.createSession({ session_id: crypto.randomUUID(), project_id: projectId });
      await addMessage(sessions, created.view.session_id);
    }
    const orphan = crypto.randomUUID();
    sessions.metaRepo.create({ sessionId: orphan, title: "Orphan", permissionMode: "controlled" });

    const list = vi.spyOn(sessions.piRepo, "list");
    const listed = await sessions.listSessions();
    expect(list).toHaveBeenCalledTimes(1);
    expect(listed).toHaveLength(3);
    expect(listed.map((item) => item.project_id).sort()).toEqual([null, "proj-a", "proj-b"].sort());
    expect(sessions.metaRepo.get(orphan)).toBeUndefined();
  });

  it("accepts project_id over HTTP and rejects invalid values", async () => {
    const { server } = await setup();

    const created = await server.inject({
      method: "POST",
      url: "/agent-api/v1/sessions",
      payload: { session_id: crypto.randomUUID(), project_id: "proj-a" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ project_id: "proj-a" });

    const unowned = await server.inject({
      method: "POST",
      url: "/agent-api/v1/sessions",
      payload: { session_id: crypto.randomUUID(), project_id: null },
    });
    expect(unowned.statusCode).toBe(201);
    expect(unowned.json()).toMatchObject({ project_id: null });

    const listed = await server.inject({ method: "GET", url: "/agent-api/v1/sessions" });
    expect(listed.json().map((item: { project_id: string | null }) => item.project_id).sort())
      .toEqual([null, "proj-a"].sort());

    for (const projectId of [42, "", ["proj-a"], { id: "proj-a" }, true]) {
      const response = await server.inject({
        method: "POST",
        url: "/agent-api/v1/sessions",
        payload: { session_id: crypto.randomUUID(), project_id: projectId },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });
});
