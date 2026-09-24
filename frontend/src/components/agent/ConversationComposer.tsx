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
import { openObject, uploadImages } from "../../data/actions";
import { CHAT_EDITION } from "../../edition";
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
  const video = useSession((s) => s.composerVideo);
  const setVideo = useSession((s) => s.setComposerVideo);
  const uploading = useSession((s) => s.composerVideoUploading);
  const setUploading = useSession((s) => s.setComposerVideoUploading);
  const notify = useSession((s) => s.notify);
  const setPreview = useSession((s) => s.setImagePreview);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const isVideo = (file: File): boolean =>
    !CHAT_EDITION && (file.type === "video/mp4" || file.type === "video/webm" || /\.(mp4|webm)$/iu.test(file.name));

  // 被拒的附件逐条提示原因——静默丢弃会让用户以为图已经带上了（G5）。
  const reportRejections = (rejected: Rejection[]) => {
    for (const item of rejected) {
      const key = item.reason === "unsupported_type" && !CHAT_EDITION
        ? "agent_attach_reject_unsupported_file"
        : `agent_attach_reject_${item.reason}` as const;
      notify("crit", t(key, { name: item.name }));
    }
  };

  const intake = async (files: (File | Blob)[]) => {
    if (!files.length || disabled || uploading) return;
    const videos = files.filter((file): file is File => file instanceof File && isVideo(file));
    const images = files.filter((file) => !(file instanceof File && isVideo(file)));
    const result = await addFiles(useSession.getState().composerAttachments, images);
    setAttachments(result.attachments);
    reportRejections(result.rejected);
    for (const extra of videos.slice(1)) notify("crit", t("agent_video_one_only", { name: extra.name }));
    const picked = videos[0];
    if (!picked) return;
    setUploading(true);
    try {
      const uploaded = await uploadImages([picked]);
      const accepted = uploaded.accepted[0];
      if (!accepted || uploaded.source.modality !== "video") throw new Error(t("agent_video_missing"));
      setVideo({ objectId: accepted.id, name: picked.name });
    } catch (error) {
      notify("crit", t("agent_video_upload_failed", {
        name: picked.name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((item) => item.id !== id));
  };

  const removeVideo = () => {
    setVideo(null);
    const current = useSession.getState();
    if (current.focus?.object_id === video?.objectId) current.setFocus(null);
  };

  const submit = async () => {
    const next = content.trim();
    const pending = attachments;
    const pendingVideo = video;
    if ((!next && !pending.length) || disabled || running || uploading) return;
    try {
      if (pendingVideo) {
        await openObject(pendingVideo.objectId, "video");
        if (useSession.getState().focus?.object_id !== pendingVideo.objectId) {
          throw new Error(t("agent_video_missing"));
        }
      }
      setContent("");
      setAttachments([]);
      setVideo(null);
      await onSend(next, toPromptImages(pending));
    } catch (error) {
      setContent(next);
      setAttachments(pending);
      setVideo(pendingVideo);
      if (error instanceof Error && error.message === t("agent_video_missing")) notify("crit", error.message);
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
      {!CHAT_EDITION && video && (
        <div className="composer-video" aria-label={t("agent_video_attached", { name: video.name })}>
          <Icon icon={ICONS.file} size="sm" />
          <span title={video.name}>{t("modality.video")}: {video.name}</span>
          <button
            type="button"
            title={t("agent_attach_remove", { name: video.name })}
            aria-label={t("agent_attach_remove", { name: video.name })}
            onClick={removeVideo}
          ><Icon icon={ICONS.close} size="sm" /></button>
        </div>
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
          accept={CHAT_EDITION ? IMAGE_MIME_TYPES.join(",") : [...IMAGE_MIME_TYPES, ".mp4", ".webm"].join(",")}
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
          disabled={disabled || uploading || (CHAT_EDITION && attachments.length >= MAX_IMAGES)}
          title={t(CHAT_EDITION ? "agent_attach_image" : "agent_attach_file")}
          aria-label={t(CHAT_EDITION ? "agent_attach_image" : "agent_attach_file")}
          onClick={() => fileInputRef.current?.click()}
        >
          ＋ {uploading ? t("agent_video_uploading") : t(CHAT_EDITION ? "agent_attach_image" : "agent_attach_file")}
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
            disabled={disabled || uploading || (!content.trim() && !attachments.length)}
            onClick={() => void submit()}
          >
            <Icon icon={ICONS.send} size="sm" /> {t("agent_send")}
          </button>
        )}
      </div>
    </div>
  );
}
