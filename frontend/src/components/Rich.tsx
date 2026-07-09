import { useI18n, type I18nKey } from "../i18n";

// 渲染含 <b>/<span class=mono>/<div class=tagline> 的译文（智能体发言、HUD 等）。
// 模板来自内建静态字典（en.ts/zh.ts），但插值变量不是——多个调用点把后端可扩展注册表
// （GET /capabilities.id / GET /tasks[].label / TaskOverlaySpec.role / Measure.value）当
// 作 var 透传，叠加上 VLM key 明文存 localStorage、无 CSP 即可被存储型 XSS 一键外泄。
// 修复：在信任边界（即将进 dangerouslySetInnerHTML 之前）做 HTML 转义；模板里的标签安全。
function escapeHtml(s: unknown): string {
  const v = String(s);
  return v.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function escapeVars(vars?: Record<string, unknown>): Record<string, string> | undefined {
  if (!vars) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(vars)) out[k] = escapeHtml(vars[k]);
  return out;
}

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
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: t(k, escapeVars(vars)) }} />;
}
