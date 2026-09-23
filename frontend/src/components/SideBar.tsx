import { useState, type ReactNode } from "react";

import type { CapabilityLayer, Modality } from "../api/types";
import {
  loadObjects,
  openObject,
  prunedRecent,
  reRunActiveModel,
  refreshDataSources,
  removeDataSource,
} from "../data/actions";
import { datasourceOf, displayName } from "../data/objectInfo";
import { ImportPanel } from "./ImportPanel";
import { useI18n, type I18nKey } from "../i18n";
import { useModalityLabel } from "../i18n/modalityLabel";
import { activeObject, objectsOf, useSession } from "../store/session";
import { AtlasView } from "./atlas/AtlasView";
import { Icon } from "./Icon";
import { FALLBACK_ICON, ICONS, KIND_ICON } from "./iconMap";

// ---- 文件树（F5：images/ 由真实 /images 驱动，选图触发分割/检测+测量） ----
const IMG_LIMIT = 14; // images/ 展开时先显 14 个，其余折叠为 "…N more"

// 模态切换（SDD 08 D-1、SDD 10 D-22）——可见性与标签都来自数据源：只列有 active 数据源的模态，
// 标签按 label_key → label → modality 取，无任务的模态（通用图像、视频）不再需要特判。
function ModalitySwitch() {
  const modality = useSession((s) => s.modality);
  const datasources = useSession((s) => s.datasources);
  const label = useModalityLabel();

  const seen = new Set<Modality>();
  const opts: Modality[] = [];
  for (const d of datasources) {
    if (d.status !== "active" || seen.has(d.modality)) continue;
    seen.add(d.modality);
    opts.push(d.modality);
  }
  if (opts.length < 2) return null; // 单模态无需切换器

  return (
    <div className="modsw" data-n={opts.length}>
      {opts.map((m) => (
        <button
          key={m}
          className={"modseg" + (modality === m ? " on" : "")}
          onClick={() => void loadObjects(m)}
        >
          {label(m)}
        </button>
      ))}
    </div>
  );
}

// 最近使用（SDD 08 §5.4/§9.4）——只读本地记录，点击一律 openObject（对象所属模态未加载时顺带加载）。
function RecentList() {
  const { t } = useI18n();
  useSession((s) => s.recentItems); // 订阅变更
  const items = prunedRecent();
  if (!items.length) return null;
  const open = (modality: string, id: string) => void openObject(id, modality as Modality);
  return (
    <>
      <div className="sec">{t("exp_recent")}</div>
      {items.map((it) => (
        <button
          key={`${it.modality}:${it.id}`}
          type="button"
          className="row"
          style={{ paddingLeft: 16 }}
          onClick={() => open(it.modality, it.id)}
        >
          <span className="tw" />
          <Icon icon={ICONS.file} size="sm" className="ico fico" />
          <span className="nm">{it.label}</span>
        </button>
      ))}
    </>
  );
}

// 文件栏空态（SDD 08 §5.4/§11）——新用户第一屏是「把你的数据放进来」，不是四个演示数据集。
function ExplorerEmpty() {
  const { t } = useI18n();
  return (
    <div className="exp-empty">
      <div className="exp-empty-title">{t("exp_empty_title")}</div>
      <div className="exp-empty-sub">{t("exp_empty_sub")}</div>
      <ImportPanel compact />
    </div>
  );
}

function ExplorerFailed() {
  const { t } = useI18n();
  return (
    <div className="exp-empty">
      <div className="exp-empty-title">{t("exp_ds_failed")}</div>
      <button type="button" className="dsbtn" onClick={() => void refreshDataSources()}>
        {t("exp_retry")}
      </button>
    </div>
  );
}

function ImageLeaf({
  id,
  depth,
  selected,
  onSelect,
}: {
  id: string;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={"row" + (selected ? " sel" : "")}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="tw" />
      <Icon icon={ICONS.file} size="sm" className="ico fico" />
      <span className="nm">{id}</span>
      {selected && <Icon icon={ICONS.check} size="sm" className="dot" />}
    </button>
  );
}

function Dir({
  name,
  depth,
  defaultOpen,
  tag,
  children,
}: {
  name: string;
  depth: number;
  defaultOpen?: boolean;
  tag?: "gold" | "agent";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <>
      <button
        type="button"
        className="row"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="tw"><Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" /></span>
        <span className={"nm" + (tag === "gold" ? " gold" : "")}>{name}</span>
        {tag === "gold" && <span className="tag">gold</span>}
        {tag === "agent" && <span className="tag" style={{ color: "var(--agent)" }}>agent</span>}
      </button>
      {open && children}
    </>
  );
}

export function ExplorerView() {
  const dsState = useSession((s) => s.dsState);
  const datasources = useSession((s) => s.datasources);
  const hasActive = datasources.some((d) => d.status === "active");
  // 三态先于一切数据渲染（§11）：loading 显骨架不显文案（避免闪烁），failed 与「空」严格区分。
  if (dsState === "loading") return <div className="sb-view exp-skel" aria-busy="true" />;
  if (dsState === "failed") return <ExplorerFailed />;
  if (!hasActive) return <ExplorerEmpty />;
  return <ExplorerTree />;
}

function ExplorerTree() {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  const modality = useSession((s) => s.modality);
  const list = useSession((s) => objectsOf(s));
  const focusId = useSession((s) => s.focus?.object_id ?? null);
  const obj = useSession((s) => activeObject(s));
  const datasources = useSession((s) => s.datasources);
  const label = useModalityLabel();
  const shown = list.slice(0, IMG_LIMIT);
  const rest = list.length - shown.length;
  // 工作区名取当前对象所属数据源；无焦点时取模态标签——不按模态硬写数据集名（DEBT-20）。
  const ws = datasourceOf(datasources, obj)?.name ?? (modality ? label(modality) : "");
  const methods = obj?.methods ?? [];

  return (
    <div className="sb-view">
      <ModalitySwitch />
      <div className="exp-head">
        <span className="ws">{ws}</span>
        <button
          type="button"
          className="exp-add"
          title={t("exp_import")}
          aria-label={t("exp_import")}
          onClick={() => setImportOpen((o) => !o)}
        >
          <Icon icon={ICONS.plus} size="sm" />
        </button>
      </div>
      {importOpen && <ImportPanel compact />}
      <RecentList />
      <div>
        <Dir name={t("exp_objects")} depth={0} defaultOpen>
          {shown.map((m) => (
            <ImageLeaf
              key={m.id}
              id={displayName(m)}
              depth={1}
              selected={focusId === m.id}
              onSelect={() => void openObject(m.id)}
            />
          ))}
          {rest > 0 && (
            <div className="row" style={{ paddingLeft: 16 }}>
              <span className="tw" />
              <span className="nm" style={{ color: "var(--faint)" }}>…{rest} more</span>
            </div>
          )}
        </Dir>
        {methods.length > 0 && (
          <Dir name={t("exp_methods")} depth={0} defaultOpen>
            {methods.map((mth) => (
              <div key={mth.name} className="row" style={{ paddingLeft: 16 }}>
                <span className="tw" />
                <span className={"nm" + (mth.role === "gold" ? " gold" : "")}>{mth.name}</span>
                {mth.role === "gold" && <span className="tag">gold</span>}
                {mth.role === "agent" && (
                  <span className="tag" style={{ color: "var(--agent)" }}>agent</span>
                )}
              </div>
            ))}
          </Dir>
        )}
      </div>
    </div>
  );
}

// ---- 插件市场（能力注册表浏览器，§5）——按环境四要素分组的卡片墙 ----
const LAYERS: { layer: CapabilityLayer; key: I18nKey }[] = [
  { layer: "representation", key: "lay_representation" },
  { layer: "action", key: "lay_action" },
  { layer: "verification", key: "lay_verification" },
  { layer: "memory", key: "lay_memory" },
];

// 「模型/数据集/skill/连接器/MCP/知识库」= 一套 Capability 清单（洞见：skill = TaskPlugin）。
// v0：Model 卡可点激活（驱动运行模型），余为目录卡（状态徽标）；加一种能力 = 后端清单加一条，前端零改。
function MarketplaceView() {
  const { t, lang } = useI18n();
  const caps = useSession((s) => s.capabilities);
  const models = useSession((s) => s.models);
  const datasources = useSession((s) => s.datasources);
  const activate = useSession((s) => s.activateModel);
  const modelById = new Map(models.map((m) => [m.id, m]));
  // 数据源 id → origin（用于导入源可删 + dev-mode 标识）。capability id 形如 dataset:<source_id>。
  const dsById = new Map(datasources.map((d) => [d.id, d]));
  const devMode = datasources.some((d) => d.origin === "builtin");

  return (
    <div className="sb-view">
      <div className="dsmode">
        <span className={"dsmode-dot" + (devMode ? " dev" : " prod")} />
        {devMode
          ? lang === "zh" ? "开发者模式（内置数据源）" : "Developer mode (built-in sources)"
          : lang === "zh" ? "产品模式（仅导入源）" : "Product mode (imported only)"}
      </div>
      {LAYERS.map(({ layer, key }) => {
        const items = caps.filter((c) => c.layer === layer);
        if (!items.length && layer !== "representation") return null;
        return (
          <div key={layer}>
            <div className="sec">{t(key)}</div>
            {layer === "representation" && <ImportPanel />}
            {items.map((c) => {
              // 导入源（dataset:imported-*）显 × 可删；builtin/占位卡不可删。
              const dsId = c.kind === "dataset" ? c.id.replace(/^dataset:/, "") : "";
              const removable = dsById.get(dsId)?.origin === "imported";
              // id 命中已装模型即可激活（含参考方法——保留「换方法对比」的老 UX）；skill/dataset/占位卡只读。
              const model = modelById.get(c.id);
              const activatable = !!model;
              const active = !!model?.active;
              const planned = c.status === "planned";
              const badge = activatable
                ? active
                  ? t("ext_active")
                  : t("ext_enable")
                : planned
                  ? t("cap_planned")
                  : c.status === "installed"
                    ? t("cap_installed")
                    : t("cap_active");
              // 可激活卡（未激活）才可键盘聚焦触发；已激活/只读卡为纯展示，不可聚焦（内含 ✕ 子按钮，故用 role 而非 button，避免按钮嵌套）。
              const actionable = activatable && !active;
              const doActivate = () => {
                if (!actionable) return;
                activate(c.id);
                void reRunActiveModel();
              };
              return (
                <div
                  key={c.id}
                  className={"ext" + (active ? " on" : "")}
                  style={{ cursor: actionable ? "pointer" : "default", opacity: planned ? 0.55 : 1 }}
                  role={actionable ? "button" : undefined}
                  tabIndex={actionable ? 0 : undefined}
                  onClick={doActivate}
                  onKeyDown={
                    actionable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            doActivate();
                          }
                        }
                      : undefined
                  }
                >
                  <div className="top">
                    <div className="mi"><Icon icon={KIND_ICON[c.kind] ?? FALLBACK_ICON} size="md" /></div>
                    <div>
                      <div className="nm">{c.name}</div>
                      <div className="pub">
                        {c.kind}
                        {c.provider ? ` · ${c.provider}` : ""}
                      </div>
                    </div>
                    <span className={"st" + (active ? "" : " off")}>{badge}</span>
                    {removable && (
                      <button
                        className="dsrm"
                        title={t("ds_remove_keeps_files")}
                        onClick={(e) => {
                          e.stopPropagation();
                          // SDD 08 D-6：只注销、不删磁盘文件——确认文案必须把这点说清楚，
                          // 否则用户会以为点了就把自己的原图删了（或反过来，以为清干净了）。
                          if (!window.confirm(`${c.name}\n\n${t("ds_remove_keeps_files")}`)) return;
                          void removeDataSource(dsId);
                        }}
                      >
                        <Icon icon={ICONS.close} size="sm" />
                      </button>
                    )}
                  </div>
                  {c.desc && <div className="desc">{c.desc}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// 标题栏交给 dockview 面板标签（见 Shell.SidebarPane，随活动栏切换更新），此处只渲染视图主体。
export function SideBar() {
  const view = useSession((s) => s.sidebarView);
  return (
    <aside className="sidebar">
      {view === "explorer" && <ExplorerView />}
      {view === "market" && <MarketplaceView />}
      {view === "atlas" && <AtlasView />}
    </aside>
  );
}
