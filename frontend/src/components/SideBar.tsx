import { useState } from "react";

import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// ---- 文件树（M0：代表性静态结构，反映真实 CUBS 布局；M1/F5 接 read_dataset） ----
type Node = {
  n: string;
  type: "dir" | "img" | "txt" | "csv" | "muted";
  open?: boolean;
  tag?: "gold" | "ours";
  kids?: Node[];
};

const TREE: Node[] = [
  {
    n: "images",
    type: "dir",
    open: true,
    kids: [
      { n: "tech_436.tiff", type: "img" },
      { n: "tech_437.tiff", type: "img" },
      { n: "tech_438.tiff", type: "img" },
      { n: "tech_439.tiff", type: "img" },
      { n: "…497 more", type: "muted" },
    ],
  },
  { n: "CF", type: "dir", kids: [{ n: "tech_437_CF.txt", type: "txt" }] },
  {
    n: "LIMA-Profiles",
    type: "dir",
    open: true,
    kids: [
      { n: "Manual-A1", type: "dir", tag: "gold" },
      { n: "Manual-A2", type: "dir" },
      { n: "GT-FAMUS", type: "dir" },
      { n: "Computerized-caroSegDeep", type: "dir", tag: "ours" },
    ],
  },
  { n: "Folds", type: "dir", kids: [] },
  { n: "cohort_gtfamus.csv", type: "csv" },
];

function TreeRow({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(!!node.open);
  const activeImage = useSession((s) => s.activeImage);
  const setActiveImage = useSession((s) => s.setActiveImage);
  const isDir = node.type === "dir";
  const isImg = node.type === "img";
  const selected = isImg && activeImage === node.n.replace(/\.tiff$/, "");
  const dirty = selected; // 当前选中图标未保存圆点（M0 示意）

  const icon = node.type === "csv" ? "▦" : node.type === "img" || node.type === "txt" ? "▤" : "";
  const iconCls = node.type === "csv" ? "fico csv" : node.type === "muted" ? "" : "fico";

  return (
    <>
      <div
        className={"row" + (selected ? " sel" : "")}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (isDir) setOpen((o) => !o);
          else if (isImg) setActiveImage(node.n.replace(/\.tiff$/, ""));
        }}
      >
        <span className="tw">{isDir ? (open ? "▾" : "▸") : ""}</span>
        {!isDir && (
          <span className={"ico " + iconCls}>{icon}</span>
        )}
        <span
          className={"nm" + (node.tag === "gold" ? " gold" : "")}
          style={node.type === "muted" ? { color: "var(--faint)" } : undefined}
        >
          {node.n}
        </span>
        {node.tag === "gold" && <span className="tag">gold</span>}
        {node.tag === "ours" && <span className="tag" style={{ color: "var(--agent)" }}>agent</span>}
        {dirty && <span className="dot">●</span>}
      </div>
      {isDir && open && node.kids?.map((k) => <TreeRow key={k.n} node={k} depth={depth + 1} />)}
    </>
  );
}

function ExplorerView() {
  return (
    <div className="sb-view">
      <div className="ws">CUBS-tech</div>
      <div>{TREE.map((n) => <TreeRow key={n.n} node={n} depth={0} />)}</div>
    </div>
  );
}

function SearchView() {
  const { t } = useI18n();
  return (
    <div className="sb-view">
      <div className="stub">
        <input placeholder={t("search_ph")} />
        <div>{t("search_hint")}</div>
      </div>
    </div>
  );
}

function ScmView() {
  const { t } = useI18n();
  return (
    <div className="sb-view">
      <div className="sec">{t("scm_changes")}</div>
      <div className="row">
        <span className="tw" />
        <span className="ico dot" style={{ color: "var(--ma)" }}>M</span>
        <span className="nm">tech_437 · MA boundary</span>
        <span className="tag">{t("scm_human")}</span>
      </div>
      <div className="stub" style={{ fontSize: "11.5px" }}>{t("scm_hint")}</div>
    </div>
  );
}

function ModelsView() {
  const { t } = useI18n();
  const models = useSession((s) => s.models);
  const activate = useSession((s) => s.activateModel);
  const pushAgent = useSession((s) => s.pushAgent);

  return (
    <div className="sb-view">
      <div className="sec">{t("ext_installed")}</div>
      <div>
        {models.map((m) => {
          const icon = m.id === "caroSegDeep" ? "✦" : m.backend === "in_process" ? "◇" : "◈";
          return (
            <div
              key={m.id}
              className={"ext" + (m.active ? " on" : "")}
              onClick={() => {
                if (m.active) return;
                activate(m.id);
                pushAgent({ variant: "plain", key: "switched_model", vars: { model: m.id } });
              }}
            >
              <div className="top">
                <div className="mi">{icon}</div>
                <div>
                  <div className="nm">{m.id}</div>
                  <div className="pub">{m.pub}</div>
                </div>
                <span className={"st" + (m.active ? "" : " off")}>
                  {m.active ? t("ext_active") : t("ext_enable")}
                </span>
              </div>
              <div className="desc">{m.desc}</div>
            </div>
          );
        })}
      </div>
      <div className="sec">{t("ext_market")}</div>
      {[
        { nm: "nnU-Net", pub: "MIC-DKFZ" },
        { nm: "MedSAM", pub: "bowang-lab" },
      ].map((x) => (
        <div key={x.nm} className="ext">
          <div className="top">
            <div className="mi">◇</div>
            <div>
              <div className="nm">{x.nm}</div>
              <div className="pub">{x.pub}</div>
            </div>
            <span className="st off">{t("ext_get")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SideBar() {
  const { t } = useI18n();
  const view = useSession((s) => s.sidebarView);
  const title = { explorer: "av_explorer", search: "av_search", scm: "av_scm", models: "av_models" } as const;

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span>{t(title[view])}</span>
        <span className="acts">
          <button title="new">＋</button>
          <button title="collapse">⋯</button>
        </span>
      </div>
      {view === "explorer" && <ExplorerView />}
      {view === "search" && <SearchView />}
      {view === "scm" && <ScmView />}
      {view === "models" && <ModelsView />}
    </aside>
  );
}
