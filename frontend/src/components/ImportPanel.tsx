import { useRef, useState } from "react";

import type { Modality, UploadRejectReason, UploadResult } from "../api/types";
import { importDataSource, loadSamples, uploadImages } from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 统一导入面板（SDD 08 §5.4 / §6）——三个入口收在一处：
// 拖拽/选择本地图片上传 · 打开服务端文件夹（医学）· 加载示例数据。
// 曾经只有「服务端文件夹路径」一个入口，还埋在插件市场里：那是给开发者用的，
// 普通用户既没有那个目录概念，也没有把文件放进去的手段。

// v0 只放开端到端可用的 WSI/CT（SDD 08 D-5）；carotid/HC 数据结构复杂，导入后续。
const IMPORTABLE: { modality: Modality; label: string }[] = [
  { modality: "pathology", label: "pathology · WSI" },
  { modality: "ct_abdomen", label: "ct_abdomen · CT" },
];

const REJECT_KEY: Record<UploadRejectReason, I18nKey> = {
  unsupported_type: "imp_reject_type",
  too_large: "imp_reject_large",
  corrupt: "imp_reject_corrupt",
};

/** 前端预筛：类型/大小不合格的直接本地拒，不发请求（与后端同一套判据，后端仍是权威）。 */
const MAX_BYTES = 32 * 1024 * 1024;
const OK_TYPES = new Set(["image/jpeg", "image/png"]);

function prefilter(files: File[]): { pass: File[]; fail: { filename: string; reason: UploadRejectReason }[] } {
  const pass: File[] = [];
  const fail: { filename: string; reason: UploadRejectReason }[] = [];
  for (const f of files) {
    if (!OK_TYPES.has(f.type)) fail.push({ filename: f.name, reason: "unsupported_type" });
    else if (f.size > MAX_BYTES) fail.push({ filename: f.name, reason: "too_large" });
    else pass.push(f);
  }
  return { pass, fail };
}

export function ImportPanel({ compact }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [localRejects, setLocalRejects] = useState<{ filename: string; reason: UploadRejectReason }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // 服务端文件夹导入（医学）
  const [folderOpen, setFolderOpen] = useState(false);
  const [path, setPath] = useState("");
  const [modality, setModality] = useState<Modality>("pathology");

  const runUpload = async (files: File[]) => {
    if (!files.length || busy) return;
    const { pass, fail } = prefilter(files);
    setLocalRejects(fail);
    setResult(null);
    setMsg(null);
    if (!pass.length) return; // 全被本地筛掉，不发请求
    setBusy(true);
    try {
      setResult(await uploadImages(pass));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSamples = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const n = await loadSamples();
      if (!n) setMsg(t("imp_samples_none"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runFolder = async () => {
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

  const rejects = [...localRejects, ...(result?.rejected ?? [])];

  return (
    <div className={"imp" + (compact ? " compact" : "")}>
      <div
        className={"imp-drop" + (dragOver ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void runUpload([...e.dataTransfer.files]);
        }}
      >
        <Icon icon={ICONS.folder} size="lg" className="imp-drop-glyph" />
        <div className="imp-drop-title">{t("imp_drop_title")}</div>
        <button
          type="button"
          className="dsbtn"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "…" : t("imp_pick_files")}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/jpeg,image/png"
          style={{ display: "none" }}
          onChange={(e) => {
            void runUpload([...(e.target.files ?? [])]);
            e.target.value = ""; // 允许连选同一批文件再次触发 change
          }}
        />
        <div className="dshint">{t("imp_drop_hint")}</div>
      </div>

      {result && (
        <div className="imp-result">
          {t("imp_accepted").replace("{n}", String(result.accepted.length))}
        </div>
      )}
      {rejects.length > 0 && (
        <ul className="imp-rejects">
          {rejects.map((r, i) => (
            <li key={`${r.filename}-${i}`}>
              <span className="imp-rej-name">{r.filename}</span>
              <span className="imp-rej-why">{t(REJECT_KEY[r.reason])}</span>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="imp-link" disabled={busy} onClick={() => void runSamples()}>
        {t("imp_load_samples")}
      </button>

      <button
        type="button"
        className="dsimp-hd"
        aria-expanded={folderOpen}
        onClick={() => setFolderOpen((o) => !o)}
      >
        <span className="tw">
          <Icon icon={folderOpen ? ICONS.chevronDown : ICONS.chevronRight} size="sm" />
        </span>
        <span>{t("imp_open_folder")}</span>
      </button>
      {folderOpen && (
        <div className="dsimp-bd">
          <input
            className="dsin"
            placeholder={lang === "zh" ? "服务端文件夹路径" : "server folder path"}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runFolder()}
          />
          <select
            className="dsin"
            value={modality}
            onChange={(e) => setModality(e.target.value as Modality)}
          >
            {IMPORTABLE.map((m) => (
              <option key={m.modality} value={m.modality}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="dsbtn" disabled={busy || !path.trim()} onClick={() => void runFolder()}>
            {busy ? "…" : lang === "zh" ? "导入" : "Import"}
          </button>
          <div className="dshint">{t("imp_folder_hint")}</div>
        </div>
      )}

      {msg && <div className="dsmsg">{msg}</div>}
    </div>
  );
}
