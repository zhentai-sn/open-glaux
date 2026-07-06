import { useI18n, type I18nKey } from "../i18n";

// 渲染含 <b>/<span class=mono>/<div class=tagline> 的译文（智能体发言、HUD 等）。
// 内容全部来自内建静态字典（en.ts/zh.ts），非用户输入 → dangerouslySetInnerHTML 安全。
export function Rich({
  k,
  vars,
  as: Tag = "span",
  className,
}: {
  k: I18nKey;
  vars?: Record<string, string>;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
}) {
  const { t } = useI18n();
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: t(k, vars) }} />;
}
