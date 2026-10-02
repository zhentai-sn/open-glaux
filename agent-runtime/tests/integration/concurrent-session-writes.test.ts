/**
 * 并发会话写入（storage/serialized-sqlite.ts）：两个会话各自的连接同时追加记录，
 * 以及同一会话上并发的两次追加，都不得报「Failed to append SQLite session entry」。
 */
import { describe, expect, it } from "vitest";

import { createRuntimeFixture } from "../helpers/runtime-fixture.js";

describe("concurrent Pi session writes", () => {
  it("serializes appends across sessions and on the same session", async () => {
    const fixture = await createRuntimeFixture();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    try {
      // 空会话会被复用（SDD 13 §7.6 规则 3）：先给每个会话写一条消息再建下一个。
      for (const id of ids) {
        await fixture.sessions.createSession({ session_id: id });
        const seeded = await fixture.sessions.openSession(id);
        await seeded.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
        await fixture.sessions.closeSession(seeded);
      }
      const sessions = await Promise.all(ids.map((id) => fixture.sessions.openSession(id)));
      try {
        await Promise.all(
          sessions.flatMap((session, s) =>
            Array.from({ length: 15 }, (_, i) => session.appendCustomEntry("glaux.test", { s, i }))),
        );
        for (const session of sessions) {
          const entries = (await session.getEntries()).filter((e) => e.type === "custom" && e.customType === "glaux.test");
          expect(entries).toHaveLength(15);
        }
      } finally {
        await Promise.all(sessions.map((session) => fixture.sessions.closeSession(session)));
      }
    } finally {
      await fixture.close();
    }
  });
});
