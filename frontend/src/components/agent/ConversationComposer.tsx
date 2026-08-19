import { useRef, useState } from "react";

import {
  addFiles,
  imagesFromClipboard,
  toPromptImages,
  IMAGE_MIME_TYPES,
  MAX_IMAGES,
  type Attachment,
  type Rejection,
} from "../../agent/attachments";
import type { PromptImage } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

interface ConversationComposerProps {
  running: boolean;
  disabled: boolean;
  onSend: (content: string, images: PromptImage[]) => Promise<void>;
  onAbort: () => Promise<void>;
}

export function ConversationComposer({
  running,
  disabled,
  onSend,
  onAbort,
}: ConversationComposerProps) {
  const { t } = useI18n();
  // 草稿在 store（非组件 state）：模式切换会重挂载对话列，未发送内容不得丢（SDD feats/01 §8/§15）。
  // 图像附件同理（SDD 00 D-021）。
  const content = useSession((s) => s.composerDraft);
  const setContent = useSession((s) => s.setComposerDraft);
  const attachments = useSession((s) => s.composerAttachments);
  const setAttachments = useSession((s) => s.setComposerAttachments);
  const notify = useSession((s) => s.notify);
  const setPreview = useSession((s) => s.setImagePreview);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // 被拒的附件逐条提示原因——静默丢弃会让用户以为图已经带上了（G5）。
  const reportRejections = (rejected: Rejection[]) => {
    for (const item of rejected) {
      notify("crit", t(`agent_attach_reject_${item.reason}`, { name: item.name }));
    }
  };

  const intake = async (files: (File | Blob)[]) => {
    if (!files.length || disabled) return;
    const result = await addFiles(useSession.getState().composerAttachments, files);
    setAttachments(result.attachments);
    reportRejections(result.rejected);
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((item) => item.id !== id));
  };

  const submit = async () => {
    const next = content.trim();
    const pending = attachments;
    if ((!next && !pending.length) || disabled || running) return;
    setContent("");
    setAttachments([]);
    try {
      await onSend(next, toPromptImages(pending));
    } catch {
      setContent(next);
      setAttachments(pending);
    }
  };

  return (
    <div
      className={`conversation-composer${dragging ? " dragover" : ""}`}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        void intake(Array.from(event.dataTransfer.files));
      }}
    >
      {attachments.length > 0 && (
        <ul className="composer-attachments" aria-label={t("agent_attachments")}>
          {attachments.map((item: Attachment) => (
            <li key={item.id}>
              {/* 用 button 包一层而非给 img 加 onClick：键盘可达（SDD 05 R1）。 */}
              <button
                type="button"
                className="attachment-open"
                title={t("agent_image_zoom", { name: item.name })}
                aria-label={t("agent_image_zoom", { name: item.name })}
                onClick={() => setPreview({ src: item.dataUrl, alt: item.name })}
              >
                <img src={item.dataUrl} alt={item.name} />
              </button>
              <button
                type="button"
                className="attachment-remove"
                title={t("agent_attach_remove", { name: item.name })}
                aria-label={t("agent_attach_remove", { name: item.name })}
                onClick={() => removeAttachment(item.id)}
              >
                <Icon icon={ICONS.close} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label={t("ph")}
        placeholder={t("ph")}
        value={content}
        disabled={disabled}
        rows={3}
        onChange={(event) => setContent(event.target.value)}
        onPaste={(event) => {
          const images = imagesFromClipboard(event.clipboardData);
          if (!images.length) return;
          // 只在确实拿到图像时吞掉默认行为，"图 + 文字"一起粘贴时文字仍照常入框。
          if (!event.clipboardData.getData("text/plain")) event.preventDefault();
          void intake(images);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            void intake(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="composer-attach"
          disabled={disabled || attachments.length >= MAX_IMAGES}
          title={t("agent_attach_image")}
          aria-label={t("agent_attach_image")}
          onClick={() => fileInputRef.current?.click()}
        >
          ＋ {t("agent_attach_image")}
        </button>
        {running ? (
          <button
            className="composer-primary stop"
            type="button"
            onClick={() => void onAbort()}
          >
            ■ {t("agent_stop")}
          </button>
        ) : (
          <button
            className="composer-primary"
            type="button"
            disabled={disabled || (!content.trim() && !attachments.length)}
            onClick={() => void submit()}
          >
            <Icon icon={ICONS.send} size="sm" /> {t("agent_send")}
          </button>
        )}
      </div>
    </div>
  );
}
