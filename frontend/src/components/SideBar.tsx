import { useState, type ReactNode } from "react";

import { reRunActiveModel, selectImage } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// ---- 文件树（F5：images/ 由真实 /images 驱动，选图触发分割+测量） ----
const IMG_LIMIT = 14; // images/ 展开时先显 14 个，其余折叠为 "…N more"

function ImageLeaf({ id, depth }: { id: string; depth: number }) {
  const activeImage = useSession((s) => s.activeImage);
  const selected = activeImage === id;
  return (
    <div
      className={"row" + (selected ? " sel" : "")}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={() => void selectImage(id)}
    >
      <span className="tw" />
      <span className="ico fico">▤</span>
      <span className="nm">{id}.tiff</span>
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
  const images = useSession((s) => s.images);
  const methods = useSession((s) => s.imageMeta?.methods ?? []);
  const shown = images.slice(0, IMG_LIMIT);
  const rest = images.length - shown.length;

  return (
    <div className="sb-view">
      <div className="ws">CUBS-tech</div>
      <div>
        <Dir name="images" depth={0} defaultOpen>
          {shown.map((m) => (
            <ImageLeaf key={m.id} id={m.id} depth={1} />
          ))}
          {rest > 0 && (
            <div className="row" style={{ paddingLeft: 16 }}>
              <span className="tw" />
              <span className="nm" style={{ color: "var(--faint)" }}>…{rest} more</span>
            </div>
          )}
        </Dir>
        <Dir name="CF" depth={0} />
        <Dir name="LIMA-Profiles" depth={0} defaultOpen={methods.length > 0}>
          {methods.map((mth) => (
            <div key={mth} className="row" style={{ paddingLeft: 16 }}>
              <span className="tw" />
              <span className={"nm" + (mth === "Manual-A1" ? " gold" : "")}>{mth}</span>
              {mth === "Manual-A1" && <span className="tag">gold</span>}
              {mth === "caroSegDeep" && <span className="tag" style={{ color: "var(--agent)" }}>agent</span>}
            </div>
          ))}
        </Dir>
        <Dir name="Folds" depth={0} />
      </div>
    </div>
  );
}

// 未实现的视图统一走诚实的 WIP 占位（不摆假数据/假输入）。
function WipView({ badge, note }: { badge: string; note: string }) {
  const { t } = useI18n();
  return (
    <div className="sb-view">
      <div className="stub">
        <span className="wip">{t("wip_badge")}</span>
        <div style={{ marginTop: 8, fontWeight: 600, color: "var(--mid)" }}>{badge}</div>
        <div style={{ marginTop: 6 }}>{note}</div>
      </div>
    </div>
  );
}

function SearchView() {
  const { t } = useI18n();
  return <WipView badge={t("av_search")} note={t("search_hint")} />;
}

function ScmView() {
  const { t } = useI18n();
  return <WipView badge={t("av_scm")} note={t("scm_hint")} />;
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
                void reRunActiveModel();
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
      <div className="sec">
        {t("ext_market")} <span className="wip" style={{ marginLeft: 6 }}>{t("wip_badge")}</span>
      </div>
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
      </div>
      {view === "explorer" && <ExplorerView />}
      {view === "search" && <SearchView />}
      {view === "scm" && <ScmView />}
      {view === "models" && <ModelsView />}
    </aside>
  );
}
