import { type LucideIcon } from "lucide-react";

// 统一图标封装（SDD feats/06）——尺寸走 --icon-* token（className 控制，不写死像素），
// currentColor 着色（随上下文文本色/语义类名，主题切换零改），strokeWidth 对齐 ActivityBar 既有 SVG 语言。
// 装饰图标默认 aria-hidden；作为唯一可视标签的交互图标传 label → aria-label + role=img。
const SIZE_CLASS = { sm: "icon-sm", md: "icon-md", lg: "icon-lg", xl: "icon-xl" } as const;

export function Icon({
  icon: Glyph,
  size = "md",
  label,
  className,
}: {
  icon: LucideIcon;
  size?: keyof typeof SIZE_CLASS;
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      className={`gicon ${SIZE_CLASS[size]}${className ? " " + className : ""}`}
      strokeWidth={1.6}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
