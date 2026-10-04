import type { MountedTool, ToolItem, UnmountedTool } from "../../agent/runtime/types";
import { useI18n, type I18nKey } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { PreviewNotice, PreviewToolbar } from "./SystemSection";
import type { PreviewState } from "./shared";

// 「工具」分区（SDD 19 §5.1、§7.5）：静态目录按插件分组；挂载状态只来自预览。

function ToolRow({ tool, mounted, unmounted }: { tool: ToolItem; mounted?: MountedTool; unmounted?: UnmountedTool }) {
  const { t } = useI18n();
  // 动态键：缺键时 t 回退为键名，据此判断「没有译文」
  const optional = (key: string) => {
    const text = t(key as I18nKey);
    return text === key ? null : text;
  };
  const summary = optional(`tool_desc_${tool.name}`);
  const reason = unmounted
    ? unmounted.reason === "plugin_inactive"
      ? optional(`plugin_inactive_${tool.plugin}`) ?? t("reason_plugin_inactive")
      : t(`reason_${unmounted.reason}` as I18nKey)
    : null;
  const head = (
    <>
      <span className="res-item-name">{tool.name}</span>
      <span className={`ctx-effect ctx-effect-${tool.effect}`}>{t(`effect_${tool.effect}` as I18nKey)}</span>
      {tool.requires.map((req) => (
        <span key={req} className="res-badge">{t(`req_${req}` as I18nKey)}</span>
      ))}
      {mounted && (
        <span className="ctx-mount on"><Icon icon={ICONS.check} size="sm" /> {t("ctx_tool_mounted")}</span>
      )}
      {reason && <span className="ctx-mount">{t("ctx_tool_unmounted", { reason })}</span>}
      {/* 一句话说明独占一行，挂载与否都直接可见 */}
      {summary && <span className="res-item-desc ctx-tool-summary">{summary}</span>}
    </>
  );
  return (
    <li className="ctx-tool" data-tool={tool.name}>
      {mounted ? (
        <details>
          <summary className="ctx-tool-head">{head}</summary>
          <div className="ctx-tool-def">
            <div className="res-hint">
              {t("ctx_tool_model_view")} · {t("ctx_tokens", { n: mounted.est_tokens })}
            </div>
            <pre className="res-preview mono">{mounted.description}</pre>
            <pre className="res-preview mono">{JSON.stringify(mounted.parameters, null, 2)}</pre>
          </div>
        </details>
      ) : (
        <div className="ctx-tool-head">{head}</div>
      )}
    </li>
  );
}

export function ToolsSection({
  tools,
  preview,
  onRefresh,
}: {
  tools: ToolItem[];
  preview: PreviewState;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const data = preview.status === "ready" || preview.status === "loading" ? preview.data : undefined;
  const mounted = new Map(data?.tools.map((tool) => [tool.name, tool]));
  const unmounted = new Map(data?.unmounted.map((tool) => [tool.name, tool]));
  const plugins = [...new Set(tools.map((tool) => tool.plugin))];

  return (
    <section className="ctx-section" data-testid="ctx-tools">
      <div className="res-hint">{t("ctx_tools_hint")}</div>
      <PreviewToolbar state={preview} onRefresh={onRefresh} />
      <PreviewNotice state={preview} />
      {data && (
        <div className="ctx-totals">
          {t("ctx_tools_summary", { mounted: data.tools.length, total: tools.length, tokens: data.est_tokens.tools })}
        </div>
      )}
      {!tools.length && <div className="res-empty">{t("res_empty")}</div>}
      {plugins.map((plugin) => (
        <section key={plugin} className="res-group">
          <div className="res-group-head">{plugin}</div>
          <ul className="ctx-tools">
            {tools.filter((tool) => tool.plugin === plugin).map((tool) => (
              <ToolRow key={tool.name} tool={tool} mounted={mounted.get(tool.name)} unmounted={unmounted.get(tool.name)} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
