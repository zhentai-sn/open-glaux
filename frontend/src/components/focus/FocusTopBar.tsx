import type { Modality } from "../../api/types";
import { selectImage, selectSlide, selectVolume, switchModality } from "../../data/actions";
import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { ConnectionConfig } from "../agent/ConnectionConfig";
import { OwlLogo } from "../OwlLogo";
import { ModeSwitch } from "./ModeSwitch";

// 轻量图像上下文选择器（SDD feats/01 D7）——模态 + 当前对象两级下拉，
// 列表/选中/动作按模态派生（同 SideBar.ExplorerView 的派生规则），选图亦可经对话。
function ImageContextPicker() {
  const { lang, t } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const images = useSession((s) => s.images);
  const volumes = useSession((s) => s.volumes);
  const slides = useSession((s) => s.slides);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);

  const isCT = modality === "ct_abdomen";
  const isWSI = modality === "pathology";
  const list = isCT ? volumes : isWSI ? slides : images;
  const activeId = isCT ? activeVolume : isWSI ? activeSlide : activeImage;
  const onSelect = isCT ? selectVolume : isWSI ? selectSlide : selectImage;

  // 模态选项按注册表去重（同 SideBar.ModalitySwitch）
  const seen = new Set<string>();
  const opts = tasks.filter((tk) => (seen.has(tk.modality) ? false : (seen.add(tk.modality), true)));

  return (
    <span className="focus-picker">
      <span className="focus-picker-glyph" aria-hidden="true">📁</span>
      {opts.length > 1 && (
        <select
          className="focus-sel"
          aria-label="modality"
          value={modality}
          onChange={(e) => void switchModality(e.target.value as Modality)}
        >
          {opts.map((tk) => (
            <option key={tk.modality} value={tk.modality}>
              {tk.label[lang]}
            </option>
          ))}
        </select>
      )}
      <select
        className="focus-sel mono"
        aria-label={t("focus_pick_image")}
        value={activeId ?? ""}
        onChange={(e) => {
          if (e.target.value) void onSelect(e.target.value);
        }}
      >
        {!activeId && <option value="">{t("focus_pick_image")}</option>}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
    </span>
  );
}

// Focus 顶栏（SDD feats/01 §8）——标识 · 图像上下文 · ⚙ 连接配置弹层 · ⇄ 模式切换。
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
      <ImageContextPicker />
      <span className="focus-cfg-anchor">
        <button
          className="focus-iconbtn"
          type="button"
          title={t("cfg_title")}
          aria-expanded={configOpen}
          onClick={() => onConfigToggle(!configOpen)}
        >
          ⚙
        </button>
        {configOpen && <ConnectionConfig onClose={() => onConfigToggle(false)} />}
      </span>
      <ModeSwitch />
    </div>
  );
}
