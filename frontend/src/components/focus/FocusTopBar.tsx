import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { ConnectionConfig } from "../agent/ConnectionConfig";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { OwlLogo } from "../OwlLogo";
import { ModeSwitch } from "./ModeSwitch";

// 只读图像上下文标签（SDD feats/01 v1.2 D14）——顶栏只**显示**「模态 · 当前对象」，
// 不再自带选择器：选图的唯一 UI 入口是右侧栏「文件」标签（复用 ExplorerView），
// 点击本 chip 即展开右侧栏并切到该标签，避免同一份派生规则在两处各写一遍。
function ImageContextChip() {
  const { lang, t } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);
  const setFocusLayout = useSession((s) => s.setFocusLayout);

  const modalityLabel =
    modality === "natural_image"
      ? t("natural_images")
      : tasks.find((tk) => tk.modality === modality)?.label[lang];
  // 活动对象按模态互斥（IMT/HC → image，CT → volume，WSI → slide），取其一即可。
  const activeId = activeImage ?? activeVolume ?? activeSlide ?? null;

  return (
    <button
      type="button"
      className={"focus-ctx" + (activeId ? "" : " empty")}
      title={t("focus_ctx_open")}
      aria-label={t("focus_ctx_open")}
      onClick={() => setFocusLayout({ rightOpen: true, browserView: "files" })}
    >
      <Icon icon={ICONS.folder} size="sm" className="focus-ctx-glyph" />
      {modalityLabel && <span className="focus-ctx-modality">{modalityLabel}</span>}
      {modalityLabel && activeId && <span className="focus-ctx-sep">·</span>}
      <span className={"focus-ctx-id" + (activeId ? " mono" : "")}>
        {activeId ?? t("focus_pick_image")}
      </span>
    </button>
  );
}

// Focus 顶栏（SDD feats/01 §8）——标识 · 图像上下文（只读，v1.2 D14）· ⚙ 连接配置弹层 · ⇄ 模式切换。
// ⚙ 弹层状态由 FocusShell 托管（空状态示例卡在未配连接时也要能拉起它）。
export function FocusTopBar({
  configOpen,
  onConfigToggle,
}: {
  configOpen: boolean;
  onConfigToggle: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="focus-topbar">
      <span className="logo" aria-hidden="true">
        <OwlLogo />
      </span>
      <b className="focus-brand">Glaux</b>
      <span className="focus-tagline">· {t("focus_tagline")}</span>
      <span className="focus-topbar-grow" />
      <ImageContextChip />
      <span className="focus-cfg-anchor">
        <button
          className="focus-iconbtn"
          type="button"
          title={t("cfg_title")}
          aria-expanded={configOpen}
          onClick={() => onConfigToggle(!configOpen)}
        >
          <Icon icon={ICONS.config} size="md" />
        </button>
        {configOpen && <ConnectionConfig onClose={() => onConfigToggle(false)} />}
      </span>
      <ModeSwitch />
    </div>
  );
}
