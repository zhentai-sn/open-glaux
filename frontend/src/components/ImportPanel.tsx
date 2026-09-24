import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { Modality, UploadRejectReason, UploadResult } from "../api/types";
import { importDataSource, loadSamples, uploadImages } from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { useModalityLabel } from "../i18n/modalityLabel";
import { useSession } from "../store/session";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 统一导入面板（SDD 08 §5.4 / §6）——三个入口收在一处：
// 拖拽/选择本地图像或视频上传 · 打开服务端文件夹（医学）· 加载示例数据。
// 曾经只有「服务端文件夹路径」一个入口，还埋在插件市场里：那是给开发者用的，
// 普通用户既没有那个目录概念，也没有把文件放进去的手段。

// 服务端文件夹导入承载浏览器上传放不下的大体积对象（SDD 08 D-5）：候选 = 任务注册表里
// 几何族为 volume / slide 的模态，不在前端手写模态清单。
const FOLDER_KINDS = new Set(["volume", "slide"]);

const REJECT_KEY: Record<UploadRejectReason, I18nKey> = {
  unsupported_type: "imp_reject_type",
  too_large: "imp_reject_large",
  corrupt: "imp_reject_corrupt",
  unsupported_codec: "imp_reject_codec",
  duration_exceeded: "imp_reject_duration",
};

/** 前端预筛：后缀/大小不合格的直接本地拒，不发请求（后端仍是权威）。
 *  可受理后缀取自 `/uploads/formats`，含尚无已注册数据源的模态；
 *  清单请求失败时只按大小预筛，类型交给后端判定。 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

function suffixOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

function prefilter(
  files: File[],
  importable: Set<string>,
): { pass: File[]; fail: { filename: string; reason: UploadRejectReason }[] } {
  const pass: File[] = [];
  const fail: { filename: string; reason: UploadRejectReason }[] = [];
  for (const f of files) {
    if (importable.size && !importable.has(suffixOf(f.name))) fail.push({ filename: f.name, reason: "unsupported_type" });
    else if (f.size > ([".mp4", ".webm"].includes(suffixOf(f.name)) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) fail.push({ filename: f.name, reason: "too_large" });
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
  const tasks = useSession((s) => s.tasks);
  const label = useModalityLabel();
  const [importable, setImportable] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    void api.uploadFormats()
      .then(({ extensions }) => {
        if (active) setImportable(new Set(extensions.map((ext) => ext.toLowerCase())));
      })
      .catch(() => {}); // 清单不可用时由上传接口校验类型
    return () => { active = false; };
  }, []);
  const folderModalities = useMemo(
    () => [...new Set(tasks.filter((tk) => tk.object_kinds.some((k) => FOLDER_KINDS.has(k))).map((tk) => tk.modality))],
    [tasks],
  );
  const [picked, setModality] = useState<Modality | null>(null);
  const modality = picked ?? folderModalities[0] ?? null;

  const runUpload = async (files: File[]) => {
    if (!files.length || busy) return;
    const { pass, fail } = prefilter(files, importable);
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
    if (!p || busy || !modality) return;
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
          accept={importable.size ? [...importable].join(",") : undefined}
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
            value={modality ?? ""}
            onChange={(e) => setModality(e.target.value as Modality)}
          >
            {folderModalities.map((m) => (
              <option key={m} value={m}>
                {label(m)}
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
