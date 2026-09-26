import { openProjectDocument } from "../../data/actions";
import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { documentErrorKey } from "../DocumentView";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 智能体 read_file 的结果卡片（SDD 14 §5.1、§7.4 规则 7）：读取不改会话的 focus 与 document，
// 由用户点「在舞台打开」决定是否预览。卡片随会话快照持久呈现（§12）。
export const FILE_READ_KIND = "glaux.file_read";

export interface FileReadPayload {
  path: string;
  name: string;
  start_line: number;
  end_line: number;
  eof: boolean;
  total_lines: number | null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** 从工具结果 details 解析（SDD 14 §9.2）；形状不符返回 null。 */
export function parseFileRead(value: unknown): FileReadPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== FILE_READ_KIND || typeof v.path !== "string" || !v.path) return null;
  if (!isInt(v.start_line) || !isInt(v.end_line) || typeof v.eof !== "boolean") return null;
  const name = typeof v.name === "string" && v.name ? v.name : v.path.slice(v.path.lastIndexOf("/") + 1);
  return {
    path: v.path,
    name,
    start_line: v.start_line,
    end_line: v.end_line,
    eof: v.eof,
    total_lines: isInt(v.total_lines) ? v.total_lines : null,
  };
}

export function FileCard({ payload }: { payload: FileReadPayload }) {
  const { t } = useI18n();
  const onStage = useSession((s) => s.document?.path === payload.path);
  const errorCode = useSession((s) => (s.documentError?.path === payload.path ? s.documentError.code : null));
  const uiMode = useSession((s) => s.uiMode);
  const setFocusLayout = useSession((s) => s.setFocusLayout);

  // 与 ObjectCard 相同：打开后在 Focus 模式展开右侧栏并切到舞台
  const reveal = () => {
    openProjectDocument(payload.path);
    if (uiMode === "focus") setFocusLayout({ rightOpen: true, sideView: "stage" });
  };

  const { start_line: start, end_line: end, total_lines: total } = payload;
  const range =
    end < start
      ? t("filecard_lines_none")
      : payload.eof && total != null
        ? t("filecard_lines_total", { start, end, total })
        : t("filecard_lines", { start, end });

  return (
    <div className="object-card" aria-label={t("filecard_label", { name: payload.name })}>
      <Icon icon={ICONS.file} size="md" />
      <div className="object-card-text">
        <span className="object-card-name" title={payload.path}>{payload.name}</span>
        <small>{range}</small>
        {errorCode && (
          <small className="object-card-error" role="alert">
            {t(documentErrorKey(errorCode))}
          </small>
        )}
      </div>
      <button type="button" disabled={onStage} onClick={reveal}>
        {onStage ? t("objcard_on_stage") : t("objcard_open_stage")}
      </button>
    </div>
  );
}
