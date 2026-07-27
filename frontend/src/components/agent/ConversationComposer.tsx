import { useState } from "react";

import { useI18n } from "../../i18n";

interface ConversationComposerProps {
  running: boolean;
  disabled: boolean;
  onSend: (content: string) => Promise<void>;
  onAbort: () => Promise<void>;
}

export function ConversationComposer({
  running,
  disabled,
  onSend,
  onAbort,
}: ConversationComposerProps) {
  const { t } = useI18n();
  const [content, setContent] = useState("");

  const submit = async () => {
    const next = content.trim();
    if (!next || disabled || running) return;
    setContent("");
    try {
      await onSend(next);
    } catch {
      setContent(next);
    }
  };

  return (
    <div className="conversation-composer">
      <textarea
        aria-label={t("ph")}
        placeholder={t("ph")}
        value={content}
        disabled={disabled}
        rows={3}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-actions">
        <button
          className="attachment-disabled"
          type="button"
          disabled
          title={t("agent_attachment_unavailable")}
        >
          ＋ {t("agent_attachment_unavailable")}
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
            disabled={disabled || !content.trim()}
            onClick={() => void submit()}
          >
            ↑ {t("agent_send")}
          </button>
        )}
      </div>
    </div>
  );
}
