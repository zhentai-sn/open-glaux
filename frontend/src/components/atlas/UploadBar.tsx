import { useRef, useState } from "react";

import { atlasApi, AtlasApiError, type UploadResult } from "../../api/atlas";
import { useI18n, type I18nKey } from "../../i18n";
import { uploadCollection, useAtlasUi } from "../../store/atlas";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 上传入口（SDD feats/03 §5.1、§6.1、D-24）：选文件 / 拖放 / 网页地址，请求返回即已入库；
// 目标图册取当前图册筛选。本批结果与文件级错误显示在条下方，描述生成交给确认条（D-28）。

export const UPLOAD_ACCEPT = "image/*,.pdf,.tif,.tiff";

const ERROR_KEYS: Record<string, I18nKey> = {
  NO_FIGURES_FOUND: "atlas_upload_err_no_figures",
  UNSUPPORTED_FILE: "atlas_upload_err_unsupported",
  BAD_IMAGE: "atlas_upload_err_bad_image",
  BAD_PDF: "atlas_upload_err_bad_pdf",
  UPLOAD_TOO_LARGE: "atlas_upload_err_too_large",
  FETCH_BLOCKED: "atlas_upload_err_blocked",
  FETCH_FAILED: "atlas_upload_err_fetch",
};

/** 上传动作与结果状态；AtlasView 的拖放区与 UploadBar 共用。 */
export function useAtlasUpload() {
  const bump = useAtlasUi((s) => s.bumpRefresh);
  const collFilter = useAtlasUi((s) => s.collectionFilter);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const run = async (fn: (collection: string | null) => Promise<UploadResult>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fn(uploadCollection(collFilter)));
      bump();
    } catch (e) {
      setError(
        e instanceof AtlasApiError
          ? { code: e.code, message: e.message }
          : { code: "", message: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    result,
    error,
    uploadFiles: (files: File[]) => (files.length ? run((c) => atlasApi.upload(files, c)) : Promise.resolve()),
    uploadUrl: (url: string) => run((c) => atlasApi.uploadUrl(url, c)),
    clear: () => {
      setResult(null);
      setError(null);
    },
  };
}

export type AtlasUpload = ReturnType<typeof useAtlasUpload>;

export function UploadBar({ upload }: { upload: AtlasUpload }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const { busy, result, error } = upload;
  const errText = (code: string, message: string) => (ERROR_KEYS[code] ? t(ERROR_KEYS[code]!) : message);

  const created = result ? result.items.filter((i) => i.created).length : 0;
  const existing = result ? result.items.length - created : 0;

  return (
    <div className="atlas-upload" data-testid="atlas-upload">
      <div className="atlas-actions">
        <button type="button" className="dsbtn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon icon={busy ? ICONS.spinner : ICONS.plus} size="sm" className={busy ? "spin" : undefined} />{" "}
          {t(busy ? "atlas_uploading" : "atlas_upload")}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          hidden
          data-testid="atlas-upload-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload.uploadFiles(files);
          }}
        />
        <form
          className="atlas-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void upload.uploadUrl(url.trim()).then(() => setUrl(""));
          }}
        >
          <input
            className="dsin"
            type="url"
            placeholder={t("atlas_upload_url_ph")}
            aria-label={t("atlas_upload_url_ph")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="atlas-btn" disabled={busy || !url.trim()}>
            {t("atlas_upload_url")}
          </button>
        </form>
      </div>
      <div className="atlas-hint">{t("atlas_upload_hint")}</div>
      {error && <div className="atlas-error">{errText(error.code, error.message)}</div>}
      {result && (
        <div className="atlas-upload-result" role="status" data-testid="atlas-upload-result">
          <span>{t("atlas_upload_done", { created, existing })}</span>
          {result.errors.length > 0 && (
            <ul>
              {result.errors.map((e) => (
                <li key={e.file}>
                  <b>{e.file}</b> · {errText(e.code, e.message)}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="atlas-link" onClick={upload.clear}>
            {t("atlas_close")}
          </button>
        </div>
      )}
    </div>
  );
}
