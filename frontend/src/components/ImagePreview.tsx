import { useI18n } from "../i18n";
import { useSession } from "../store/session";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

/**
 * 图像放大层——点击 Composer 附件缩略图或消息里的图打开（SDD 00 §5.1）。
 *
 * 与 ShortcutSheet 同构的 overlay：点遮罩关闭，Esc 由全局分发器处理（优先级高于速查面板，
 * 见 keys/globalKeys）。只做"看大图"，不做缩放平移——影像的测量与导航归查看器，不在此重复。
 */
export function ImagePreview() {
  const preview = useSession((s) => s.imagePreview);
  const setPreview = useSession((s) => s.setImagePreview);
  const { t } = useI18n();

  if (!preview) return null;
  return (
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={preview.alt || t("agent_image_preview")}
      onClick={() => setPreview(null)}
    >
      <button
        type="button"
        className="image-preview-close"
        title={t("ui_close")}
        aria-label={t("ui_close")}
        autoFocus
        onClick={() => setPreview(null)}
      >
        <Icon icon={ICONS.close} size="md" />
      </button>
      <img
        className="image-preview-img"
        src={preview.src}
        alt={preview.alt || t("agent_image_preview")}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
