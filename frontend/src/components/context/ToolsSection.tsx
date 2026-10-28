import { usePacks } from "../../data/packs";
import type { MountedTool, ToolItem, UnmountedTool } from "../../agent/runtime/types";
import type { PackProgress, PackRow } from "../../api/types";
import { useI18n, type I18nKey } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { PreviewNotice, PreviewToolbar } from "./SystemSection";
import type { PreviewState } from "./shared";

// 「工具」分区（SDD 19 §5.1、§7.5）：静态目录按插件分组；挂载状态只来自预览。
// SDD 25：声明了 pack 依赖的工具就地给出安装入口（工具定义本身仍只读）。

function PackControl({
  packId,
  row,
  progress,
  onInstall,
  onCancel,
  onUninstall,
}: {
  packId: string;
  row?: PackRow;
  progress?: PackProgress;
  onInstall: (id: string) => void;
  onCancel: (id: string) => void;
  onUninstall: (id: string) => void;
}) {
  const { t } = useI18n();
  if (!row) return null;
  const mb = Math.round(row.bytes / 1_000_000);
  const total = progress?.bytes_total || row.bytes;
  const done = progress?.bytes_done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  if (row.status === "installing") {
    return (
      <span className="ctx-pack" data-pack={packId} data-status="installing">
        <span className="ctx-pack-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span className="ctx-pack-bar" style={{ width: `${pct}%` }} />
        </span>
        <span className="res-hint">{t("pack_installing", { pct })}</span>
        <button type="button" className="ctx-pack-action" onClick={() => onCancel(packId)}>
          {t("pack_cancel")}
        </button>
      </span>
    );
  }
  if (row.status === "ready") {
    return (
      <span className="ctx-pack" data-pack={packId} data-status="ready">
        <span className="res-hint">{t("pack_ready")}</span>
        <button type="button" className="ctx-pack-action" onClick={() => onUninstall(packId)}>
          {t("pack_uninstall")}
        </button>
      </span>
    );
  }
  if (row.status === "failed") {
    return (
      <span className="ctx-pack" data-pack={packId} data-status="failed">
        <span className="res-hint ctx-pack-error">{t("pack_failed", { reason: row.error ?? "unknown" })}</span>
        <button type="button" className="ctx-pack-action" onClick={() => onInstall(packId)}>
          {t("pack_retry")}
        </button>
      </span>
    );
  }
  return (
    <span className="ctx-pack" data-pack={packId} data-status={row.status}>
      <span className="res-hint">{t("pack_size", { mb })}</span>
      <button type="button" className="ctx-pack-action" onClick={() => onInstall(packId)}>
        {t("pack_install")}
      </button>
    </span>
  );
}

function ToolRow({
  tool,
  mounted,
  unmounted,
  packRow,
  packProgress,
  onInstall,
  onCancel,
  onUninstall,
}: {
  tool: ToolItem;
  mounted?: MountedTool;
  unmounted?: UnmountedTool;
  packRow?: PackRow;
  packProgress?: PackProgress;
  onInstall: (id: string) => void;
  onCancel: (id: string) => void;
  onUninstall: (id: string) => void;
}) {
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
  const needsPack = tool.pack !== undefined && unmounted?.reason === "needs_pack";
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
      {reason && !needsPack && <span className="ctx-mount">{t("ctx_tool_unmounted", { reason })}</span>}
      {/* SDD 25：pack 未就绪时把只读原因换成可操作入口 */}
      {tool.pack && !mounted && (
        <PackControl
          packId={tool.pack}
          row={packRow}
          progress={packProgress}
          onInstall={onInstall}
          onCancel={onCancel}
          onUninstall={onUninstall}
        />
      )}
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
  // 只有存在声明了 pack 的工具时才去问 backend，避免无谓请求
  const hasPacks = tools.some((tool) => tool.pack !== undefined);
  const packs = usePacks(hasPacks);
  const packMap = new Map(packs.packs.map((row) => [row.id, row]));

  const data = preview.status === "ready" || preview.status === "loading" ? preview.data : undefined;
  const mounted = new Map(data?.tools.map((tool) => [tool.name, tool]));
  const unmounted = new Map(data?.unmounted.map((tool) => [tool.name, tool]));
  const plugins = [...new Set(tools.map((tool) => tool.plugin))];

  return (
    <section className="ctx-section" data-testid="ctx-tools">
      <div className="res-hint">{t("ctx_tools_hint")}</div>
      <PreviewToolbar state={preview} onRefresh={onRefresh} />
      <PreviewNotice state={preview} />
      {packs.error && <div className="res-hint ctx-pack-error">{t("pack_list_error")}</div>}
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
              <ToolRow
                key={tool.name}
                tool={tool}
                mounted={mounted.get(tool.name)}
                unmounted={unmounted.get(tool.name)}
                packRow={tool.pack ? packMap.get(tool.pack) : undefined}
                packProgress={tool.pack ? packs.progress[tool.pack] : undefined}
                onInstall={(id) => void packs.install(id)}
                onCancel={(id) => void packs.cancel(id)}
                onUninstall={(id) => void packs.uninstall(id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
