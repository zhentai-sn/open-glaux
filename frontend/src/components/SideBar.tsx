import { useState, type ReactNode } from "react";

import type { CapabilityLayer, Modality } from "../api/types";
import {
  importDataSource,
  reRunActiveModel,
  removeDataSource,
  selectImage,
  selectSlide,
  selectVolume,
  switchModality,
} from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { useSession } from "../store/session";

// ---- 文件树（F5：images/ 由真实 /images 驱动，选图触发分割/检测+测量） ----
const IMG_LIMIT = 14; // images/ 展开时先显 14 个，其余折叠为 "…N more"

// 模态切换——从任务注册表（GET /tasks）派生，不再硬编码模态数组/标签。
// 一模态多任务时按模态去重（取该模态首个任务的标签）。加模态 = 后端注册一行，前端零改。
function ModalitySwitch() {
  const { lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const seen = new Set<string>();
  const opts = tasks.filter((tk) => (seen.has(tk.modality) ? false : (seen.add(tk.modality), true)));
  if (opts.length < 2) return null; // 单模态无需切换器
  return (
    <div className="modsw">
      {opts.map((tk) => (
        <button
          key={tk.modality}
          className={"modseg" + (modality === tk.modality ? " on" : "")}
          onClick={() => void switchModality(tk.modality)}
        >
          {tk.label[lang]}
        </button>
      ))}
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
    <div
      className={"row" + (selected ? " sel" : "")}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={onSelect}
    >
      <span className="tw" />
      <span className="ico fico">▤</span>
      <span className="nm">{id}</span>
      {selected && <span className="dot">●</span>}
    </div>
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
      <div className="row" style={{ paddingLeft: depth * 12 + 4 }} onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? "▾" : "▸"}</span>
        <span className={"nm" + (tag === "gold" ? " gold" : "")}>{name}</span>
        {tag === "gold" && <span className="tag">gold</span>}
        {tag === "agent" && <span className="tag" style={{ color: "var(--agent)" }}>agent</span>}
      </div>
      {open && children}
    </>
  );
}

function ExplorerView() {
  const modality = useSession((s) => s.modality);
  const images = useSession((s) => s.images);
  const volumes = useSession((s) => s.volumes);
  const slides = useSession((s) => s.slides);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);
  const methods = useSession((s) => s.imageMeta?.methods ?? []);
  const center = useSession((s) => s.imageMeta?.center);
  const isHC = modality === "fetal_hc";
  const isCT = modality === "ct_abdomen";
  const isWSI = modality === "pathology";
  // 列表 + 选中 + 选择动作按模态派生（CT 走 volumes/activeVolume，WSI 走 slides/activeSlide）。
  const list = isCT ? volumes : isWSI ? slides : images;
  const activeId = isCT ? activeVolume : isWSI ? activeSlide : activeImage;
  const onSelect = isCT ? selectVolume : isWSI ? selectSlide : selectImage;
  const shown = list.slice(0, IMG_LIMIT);
  const rest = list.length - shown.length;
  // 工作区/方法名读真实元数据；无数据时按模态回退默认。
  const ws = center ?? (isHC ? "HC18" : isCT ? "CT" : isWSI ? "Pathology" : "CUBS-tech");
  const dirName = isCT || isWSI ? "slides" : "images";
  const methodsDir = isHC ? "ellipse-profiles" : isCT ? "labelmaps" : isWSI ? "detections" : "LIMA-Profiles";
  const goldMethod = isHC ? "GT-ellipse" : "Manual-A1";
  const agentMethod = isHC
    ? (methods.find((m) => m !== goldMethod) ?? "CSM")
    : isCT
      ? "totalsegmentator_v2"
      : isWSI
        ? "stardist_he"
        : "caroSegDeep";
  const isIMT = modality === "carotid_imt";

  return (
    <div className="sb-view">
      <ModalitySwitch />
      <div className="ws">{ws}</div>
      <div>
        <Dir name={dirName} depth={0} defaultOpen>
          {shown.map((m) => (
            <ImageLeaf
              key={m.id}
              id={m.id}
              depth={1}
              selected={activeId === m.id}
              onSelect={() => void onSelect(m.id)}
            />
          ))}
          {rest > 0 && (
            <div className="row" style={{ paddingLeft: 16 }}>
              <span className="tw" />
              <span className="nm" style={{ color: "var(--faint)" }}>…{rest} more</span>
            </div>
          )}
        </Dir>
        <Dir name={methodsDir} depth={0} defaultOpen={methods.length > 0}>
          {methods.map((mth) => (
            <div key={mth} className="row" style={{ paddingLeft: 16 }}>
              <span className="tw" />
              <span className={"nm" + (mth === goldMethod ? " gold" : "")}>{mth}</span>
              {mth === goldMethod && <span className="tag">gold</span>}
              {mth === agentMethod && <span className="tag" style={{ color: "var(--agent)" }}>agent</span>}
            </div>
          ))}
        </Dir>
        {isIMT && <Dir name="CF" depth={0} />}
        {isIMT && <Dir name="Folds" depth={0} />}
      </div>
    </div>
  );
}

// ---- 插件市场（能力注册表浏览器，§5）——按「环境四层」分组的卡片墙 ----
const LAYERS: { layer: CapabilityLayer; key: I18nKey }[] = [
  { layer: "representation", key: "lay_representation" },
  { layer: "action", key: "lay_action" },
  { layer: "verification", key: "lay_verification" },
  { layer: "memory", key: "lay_memory" },
];

const KIND_GLYPH: Record<string, string> = {
  skill: "✦",
  model: "◈",
  adapter: "◈",
  dataset: "▦",
  reference_method: "⚖",
  calibration_source: "⊹",
  connector: "⇄",
  mcp: "⧉",
  knowledge_base: "❋",
  correction_store: "↺",
};

// 导入数据源表单——POST /datasources（服务端可达的文件夹路径；缺标定后端自动探测）。
// v0 只放开端到端可用的 WSI/CT；carotid/HC 数据结构复杂，导入后续（见计划 §2）。
const IMPORTABLE: { modality: Modality; label: string }[] = [
  { modality: "pathology", label: "pathology · WSI" },
  { modality: "ct_abdomen", label: "ct_abdomen · CT" },
];

function ImportDataSourceForm() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [modality, setModality] = useState<Modality>("pathology");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    const p = path.trim();
    if (!p || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const status = await importDataSource(p, modality);
      setMsg((lang === "zh" ? "已导入 · 状态：" : "Imported · status: ") + status);
      setPath("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dsimp">
      <div className="dsimp-hd" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? "▾" : "▸"}</span>
        <span>{lang === "zh" ? "＋ 导入数据源" : "＋ Import data source"}</span>
      </div>
      {open && (
        <div className="dsimp-bd">
          <input
            className="dsin"
            placeholder={lang === "zh" ? "服务端文件夹路径" : "server folder path"}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <select className="dsin" value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
            {IMPORTABLE.map((m) => (
              <option key={m.modality} value={m.modality}>{m.label}</option>
            ))}
          </select>
          <button className="dsbtn" disabled={busy || !path.trim()} onClick={() => void submit()}>
            {busy ? "…" : lang === "zh" ? "导入" : "Import"}
          </button>
          {msg && <div className="dsmsg">{msg}</div>}
          <div className="dshint">
            {lang === "zh"
              ? "路径须在 ~/glaux_datasets 下；缺标定自动从文件探测（读不出则需手动补）"
              : "path must live under ~/glaux_datasets; calibration is auto-detected from files"}
          </div>
        </div>
      )}
    </div>
  );
}

// 「模型/数据集/skill/连接器/MCP/知识库」= 一套 Capability 清单（洞见：skill = TaskPlugin）。
// v0：Model 卡可点激活（驱动运行模型），余为目录卡（状态徽标）；加一种能力 = 后端清单加一条，前端零改。
function MarketplaceView() {
  const { t, lang } = useI18n();
  const caps = useSession((s) => s.capabilities);
  const models = useSession((s) => s.models);
  const datasources = useSession((s) => s.datasources);
  const activate = useSession((s) => s.activateModel);
  const pushAgent = useSession((s) => s.pushAgent);
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
            {layer === "representation" && <ImportDataSourceForm />}
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
              return (
                <div
                  key={c.id}
                  className={"ext" + (active ? " on" : "")}
                  style={{ cursor: activatable && !active ? "pointer" : "default", opacity: planned ? 0.55 : 1 }}
                  onClick={() => {
                    if (!activatable || active) return;
                    activate(c.id);
                    pushAgent({ variant: "plain", key: "switched_model", vars: { model: c.id } });
                    void reRunActiveModel();
                  }}
                >
                  <div className="top">
                    <div className="mi">{KIND_GLYPH[c.kind] ?? "◇"}</div>
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
                        title={lang === "zh" ? "移除导入源" : "Remove imported source"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeDataSource(dsId);
                        }}
                      >
                        ✕
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
    </aside>
  );
}
