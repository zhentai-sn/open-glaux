import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { ConversationComposer } from "./ConversationComposer";

/** 1×1 PNG 的字节，用来构造真实 File（jsdom 的 FileReader 会真读）。 */
const pngFile = (name = "shot.png") =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, {
    type: "image/png",
  });

/** 造一个够 paste/drop 用的 DataTransfer 替身；jsdom 不提供可构造的实现。 */
function clipboardWith(files: File[], text = ""): DataTransfer {
  return {
    items: files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    })),
    files,
    getData: () => text,
  } as unknown as DataTransfer;
}

function setup(overrides: Partial<Parameters<typeof ConversationComposer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onAbort = vi.fn().mockResolvedValue(undefined);
  render(
    <I18nProvider>
      <ConversationComposer
        running={false}
        disabled={false}
        onSend={onSend}
        onAbort={onAbort}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSend, onAbort };
}

describe("ConversationComposer image attachments", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({
      composerDraft: "",
      composerAttachments: [],
      notices: [],
    });
  });

  it("attaches a pasted image and shows a removable thumbnail", async () => {
    setup();
    const textarea = screen.getByRole("textbox");
    fireEvent.paste(textarea, { clipboardData: clipboardWith([pngFile()]) });

    const thumb = await screen.findByAltText("shot.png");
    expect(thumb).toBeTruthy();
    expect(useSession.getState().composerAttachments).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Remove shot.png"));
    expect(useSession.getState().composerAttachments).toHaveLength(0);
  });

  it("sends an image-only message and clears the draft attachments", async () => {
    const { onSend } = setup();
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: clipboardWith([pngFile()]),
    });
    await screen.findByAltText("shot.png");

    const send = screen.getByRole("button", { name: /send/i });
    expect(send).not.toHaveProperty("disabled", true);
    fireEvent.click(send);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [content, images] = onSend.mock.calls[0]!;
    expect(content).toBe("");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ mime_type: "image/png" });
    expect(useSession.getState().composerAttachments).toHaveLength(0);
  });

  it("keeps the send button disabled with neither text nor image", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /send/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("ignores a non-image paste and lets the text through", async () => {
    setup();
    const pdf = new File([new Uint8Array([1, 2])], "report.pdf", {
      type: "application/pdf",
    });
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: clipboardWith([pdf], "some text"),
    });

    // 非图像不入附件；文本粘贴的默认行为也没有被吞掉。
    await waitFor(() =>
      expect(useSession.getState().composerAttachments).toHaveLength(0),
    );
    expect(useSession.getState().notices).toHaveLength(0);
  });

  it("rejects the 7th image with a visible notice", async () => {
    setup();
    const files = Array.from({ length: 7 }, (_, index) => pngFile(`p${index}.png`));
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: clipboardWith(files),
    });

    await waitFor(() =>
      expect(useSession.getState().composerAttachments).toHaveLength(6),
    );
    // 第 7 张被拒且拒绝原因可见——静默丢弃会让用户以为图带上了。
    const notices = useSession.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain("p6.png");
    expect(notices[0]!.text).toContain("at most 6 images");
  });

  it("restores text and attachments when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <I18nProvider>
        <ConversationComposer
          running={false}
          disabled={false}
          onSend={onSend}
          onAbort={vi.fn()}
        />
      </I18nProvider>,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "look at this" } });
    fireEvent.paste(textarea, { clipboardData: clipboardWith([pngFile()]) });
    await screen.findByAltText("shot.png");

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(useSession.getState().composerAttachments).toHaveLength(1),
    );
    expect(useSession.getState().composerDraft).toBe("look at this");
  });
});
