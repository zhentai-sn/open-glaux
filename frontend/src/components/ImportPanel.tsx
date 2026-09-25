import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { UploadRejectReason, UploadResult } from "../api/types";
import { loadSamples, uploadImages } from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 统一导入面板（SDD 08 §5.4 / §6）——拖拽/选择本地图像或视频上传 · 加载示例数据。
// 服务端目录（含 CT、WSI 等大体积医学数据）经左侧栏「打开文件夹」作为项目接入（SDD 13 D-21）。

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
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [localRejects, setLocalRejects] = useState<{ filename: string; reason: UploadRejectReason }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

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

      {msg && <div className="dsmsg">{msg}</div>}
    </div>
  );
}
