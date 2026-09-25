import { CHAT_EDITION } from "../../edition";
import { useI18n } from "../../i18n";
import { OwlLogo } from "../OwlLogo";
import { ModeSwitch } from "./ModeSwitch";

// Focus 顶栏（SDD feats/01 §8 / v1.7 D24）——只剩标识与 ⇄ 模式切换（仅开放工作台时）。
// 图像上下文 chip 已移除（文件入口在左侧栏）；主题与连接配置收进左侧栏底部的「设置」。
export function FocusTopBar() {
  const { t } = useI18n();
  return (
    <div className="focus-topbar">
      <span className="logo" aria-hidden="true">
        <OwlLogo />
      </span>
      <b className="focus-brand">Glaux</b>
      <span className="focus-tagline">· {t(CHAT_EDITION ? "chat_tagline" : "focus_tagline")}</span>
      <span className="focus-topbar-grow" />
      <ModeSwitch />
    </div>
  );
}
