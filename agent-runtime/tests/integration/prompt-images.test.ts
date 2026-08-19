import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { buildServer } from "../../src/transport/server.js";
import {
  TEST_CONNECTION,
  createRuntimeFixture,
  waitFor,
} from "../helpers/runtime-fixture.js";

/** 1×1 PNG。 */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function settle(
  fixture: Awaited<ReturnType<typeof createRuntimeFixture>>,
  sessionId: string,
): Promise<void> {
  await fixture.registry.waitForIdle(sessionId);
  await waitFor(async () => {
    const session = await fixture.sessions.openSession(sessionId);
    try {
      return (await session.getEntries()).some(
        (entry) =>
          entry.type === "custom" && entry.customType === "glaux.command.settled",
      );
    } finally {
      await fixture.sessions.closeSession(session);
    }
  });
}

describe("prompt image attachments (SDD 00 D-021)", () => {
  it("sends images to the model and keeps them on the persisted user message", async () => {
    // faux provider 不记录请求，用 response factory 捕获真正发给模型的 context。
    let sent: unknown;
    const fixture = await createRuntimeFixture([
      [
        (context) => {
          sent = context;
          return fauxAssistantMessage("I see it");
        },
      ],
    ]);
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "what is this?",
        images: [{ data: PNG, mime_type: "image/png" }],
        connection: { ...TEST_CONNECTION, vision: true },
      });
      await settle(fixture, sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      const user = view.messages.find((message) => message.role === "user");
      const blocks = user?.content as { type: string; data?: string; mimeType?: string }[];
      expect(Array.isArray(blocks)).toBe(true);
      const image = blocks.find((block) => block.type === "image");
      expect(image).toMatchObject({ data: PNG, mimeType: "image/png" });

      // 图像确实进了模型请求，而不是只留在 transcript 里。
      expect(JSON.stringify(sent ?? {})).toContain(PNG.slice(0, 32));
    } finally {
      await fixture.close();
    }
  });

  it("accepts an image-only prompt and leaves the title unnamed", async () => {
    const fixture = await createRuntimeFixture([[fauxAssistantMessage("a pixel")]]);
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "",
        images: [{ data: GIF, mime_type: "image/gif" }],
        connection: TEST_CONNECTION,
      });
      await settle(fixture, sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      // 纯图消息不把标题钉成空串，留给下一条带文字的消息命名。
      expect(view.title).toBe("New conversation");
      expect(view.messages.filter((message) => message.role === "user")).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("treats a same command_id with different images as an idempotency conflict", async () => {
    const fixture = await createRuntimeFixture([[fauxAssistantMessage("ok")]]);
    const sessionId = crypto.randomUUID();
    const commandId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const command = {
        command_id: commandId,
        type: "prompt" as const,
        content: "look",
        images: [{ data: PNG, mime_type: "image/png" }],
        connection: TEST_CONNECTION,
      };
      await fixture.commands.accept(sessionId, command);
      await settle(fixture, sessionId);

      // 同图重放 = 网络重试，不产生第二条 user entry。
      await fixture.commands.accept(sessionId, command);
      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages.filter((message) => message.role === "user")).toHaveLength(1);

      await expect(
        fixture.commands.accept(sessionId, {
          ...command,
          images: [{ data: GIF, mime_type: "image/gif" }],
        }),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
    } finally {
      await fixture.close();
    }
  });

  it("replays images when regenerating an image-bearing turn", async () => {
    const fixture = await createRuntimeFixture([
      [fauxAssistantMessage("first look")],
      [fauxAssistantMessage("second look")],
    ]);
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "describe",
        images: [{ data: PNG, mime_type: "image/png" }],
        connection: TEST_CONNECTION,
      });
      await settle(fixture, sessionId);

      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "regenerate",
        connection: TEST_CONNECTION,
      });
      await fixture.registry.waitForIdle(sessionId);

      const view = await fixture.sessions.getSession(sessionId);
      const user = view.messages.find((message) => message.role === "user");
      const blocks = user?.content as { type: string }[];
      // 重发后的新分支上，用户那条消息仍带图——不退化成纯文本。
      expect(blocks.some((block) => block.type === "image")).toBe(true);
    } finally {
      await fixture.close();
    }
  });
});

describe("prompt image validation over REST", () => {
  const cases: {
    name: string;
    images: unknown;
    content?: string;
    message: string;
  }[] = [
    {
      name: "rejects a non-image mime type",
      images: [{ data: PNG, mime_type: "application/pdf" }],
      message: "mime_type",
    },
    {
      name: "rejects an oversized image",
      images: [{ data: "A".repeat(12 * 1024 * 1024 + 1), mime_type: "image/png" }],
      message: "too large",
    },
    {
      name: "rejects more than six images",
      images: Array.from({ length: 7 }, () => ({ data: PNG, mime_type: "image/png" })),
      message: "At most",
    },
    {
      name: "rejects an empty prompt with no images",
      images: [],
      content: "   ",
      message: "content or at least one image",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const fixture = await createRuntimeFixture();
      const server = buildServer({
        routes: {
          sessions: fixture.sessions,
          commands: fixture.commands,
          registry: fixture.registry,
          broker: fixture.broker,
        },
      });
      const sessionId = crypto.randomUUID();
      try {
        await fixture.sessions.createSession({ session_id: sessionId });
        const response = await server.inject({
          method: "POST",
          url: `/agent-api/v1/sessions/${sessionId}/commands`,
          payload: {
            command_id: crypto.randomUUID(),
            type: "prompt",
            content: testCase.content ?? "hi",
            images: testCase.images,
            connection: TEST_CONNECTION,
          },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("invalid_request");
        expect(response.json().error.message).toContain(testCase.message);
      } finally {
        await server.close();
        await fixture.close();
      }
    });
  }

  it("accepts a body larger than Fastify's 1 MiB default", async () => {
    const fixture = await createRuntimeFixture([[fauxAssistantMessage("big")]]);
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const response = await server.inject({
        method: "POST",
        url: `/agent-api/v1/sessions/${sessionId}/commands`,
        payload: {
          command_id: crypto.randomUUID(),
          type: "prompt",
          content: "big image",
          // 3 MiB base64：在 Fastify 默认 1 MiB 上限下会被传输层截断成 413。
          images: [{ data: "A".repeat(3 * 1024 * 1024), mime_type: "image/png" }],
          connection: TEST_CONNECTION,
        },
      });
      expect(response.statusCode).not.toBe(413);
      expect(response.statusCode).toBe(202);
    } finally {
      await server.close();
      await fixture.close();
    }
  });

  it("rejects images on regenerate and abort", async () => {
    const fixture = await createRuntimeFixture();
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      for (const payload of [
        {
          command_id: crypto.randomUUID(),
          type: "regenerate",
          images: [{ data: PNG, mime_type: "image/png" }],
          connection: TEST_CONNECTION,
        },
        {
          command_id: crypto.randomUUID(),
          type: "abort",
          images: [{ data: PNG, mime_type: "image/png" }],
        },
      ]) {
        const response = await server.inject({
          method: "POST",
          url: `/agent-api/v1/sessions/${sessionId}/commands`,
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("invalid_request");
      }
    } finally {
      await server.close();
      await fixture.close();
    }
  });
});
