import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

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
  // 草稿在 store（非组件 state）：模式切换会重挂载对话列，未发送内容不得丢（SDD feats/01 §8/§15）。
  const content = useSession((s) => s.composerDraft);
  const setContent = useSession((s) => s.setComposerDraft);

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
            <Icon icon={ICONS.send} size="sm" /> {t("agent_send")}
          </button>
        )}
      </div>
    </div>
  );
}
