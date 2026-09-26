import { useEffect, useRef, useState } from "react";
import type { Components } from "react-markdown";

import { ApiError, api } from "../api/client";
import type { ProjectText } from "../api/types";
import { closeDocument } from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { useAgentSessions } from "../store/agentSessions";
import { useSession } from "../store/session";
import { Markdown } from "./agent/Markdown";
import { CodeView, codeLanguageOf, extensionOf } from "./CodeView";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";
import { Segmented } from "./Segmented";

// 文档视图（SDD 14 §5.1、§7.3、§11.2）：会话级 document 的只读预览，绝对定位覆盖在舞台 / 编辑区之上，
// 查看器保持挂载，关闭后缩放、窗位、帧索引不变。不改 focus。

/** 预览固定读前 1 MiB、不限行数（§7.3 规则 2）。 */
export const PREVIEW_MAX_BYTES = 1048576;

export type RenderKind = "markdown" | "json" | "code";

/** 扩展名到渲染方式的分派（§7.3 规则 3，大小写不敏感）。 */
export function renderKindOf(name: string): RenderKind {
  const ext = extensionOf(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json" || ext === "ipynb") return "json";
  return "code";
}

/** 文档读取错误码到行内提示文案（§7.3 规则 10、§13）。 */
export function documentErrorKey(code: string): I18nKey {
  switch (code) {
    case "binary":
      return "doc_err_binary";
    case "not_found":
      return "doc_err_not_found";
    case "hidden_path":
      return "doc_err_hidden";
    default:
      return "doc_err_failed";
  }
}

/** 未截断且能解析的 JSON 按 2 空格缩进格式化；否则原文（§7.3 规则 3）。 */
export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 只放行 http(s) 链接（§7.3 规则 7）；相对路径与其他协议返回 null。 */
function httpHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null; // 相对路径
  }
}

// §7.3 规则 7：http(s) 链接新标签页打开；其余链接只显示文字；图片只显示 alt 文本，不发请求。
const DOC_MARKDOWN: Components = {
  a: ({ href, children }) => {
    const safe = httpHref(href);
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="docview-link">{children}</span>
    );
  },
  img: ({ alt }) => (alt ? <span className="docview-img-alt">{alt}</span> : null),
};

const ENCODING_LABEL: Record<ProjectText["encoding"], string> = {
  "utf-8": "UTF-8",
  "utf-8-sig": "UTF-8 BOM",
  "utf-16": "UTF-16",
  gb18030: "GB18030",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** text 每行保留行尾 \n；交给代码视图前去掉最后一个，避免末尾多出空行。 */
const trimFinalNewline = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text);

export function DocumentView() {
  const { t } = useI18n();
  const doc = useSession((s) => s.document);
  const projectId = useAgentSessions(
    (s) => s.sessions.find((x) => x.session_id === s.currentSessionId)?.project_id ?? null,
  );
  const [data, setData] = useState<ProjectText | null>(null);
  const [mode, setMode] = useState<"render" | "source">("render");
  const seq = useRef(0);

  // 按 document 请求正文；递增序号丢弃过期响应。document 换了对象（重新点击同一文件）即重新读取（§13）。
  useEffect(() => {
    const my = ++seq.current;
    setData(null);
    setMode("render");
    if (!doc || !projectId) {
      useSession.getState().setDocumentLoading(false);
      return; // 会话列表未就绪：等项目确定后再读
    }
    const path = doc.path;
    useSession.getState().setDocumentLoading(true);
    api
      .projectText(projectId, path, { maxBytes: PREVIEW_MAX_BYTES })
      .then((r) => {
        if (my === seq.current) setData(r);
      })
      .catch((err: unknown) => {
        if (my !== seq.current) return;
        // §7.3 规则 10：document 置空（回到前一舞台状态），错误交目录树 / 文件卡片行内显示
        const code = err instanceof ApiError && err.code ? err.code : "unknown";
        const s = useSession.getState();
        s.setDocumentError({ path, code });
        if (s.document === doc) s.setDocument(null);
      })
      .finally(() => {
        if (my === seq.current) useSession.getState().setDocumentLoading(false);
      });
  }, [doc, projectId]);

  // 卸载：作废在途请求并清加载态
  useEffect(
    () => () => {
      seq.current++;
      useSession.getState().setDocumentLoading(false);
    },
    [],
  );

  if (!doc) return null;
  const name = data?.name ?? baseName(doc.path);
  const kind = renderKindOf(name);
  // 截断提示（§7.3 规则 2）：未读到末尾，或最后一行被字节上限截断
  const truncated = !!data && (!data.eof || data.line_truncated);

  let body: JSX.Element;
  if (!data) {
    body = (
      <div className="docview-loading" aria-busy="true">
        <Icon icon={ICONS.spinner} size="sm" className="spin" /> {t("doc_loading")}
      </div>
    );
  } else if (kind === "markdown" && mode === "render") {
    body = (
      <div className="docview-md">
        <Markdown text={data.text} components={DOC_MARKDOWN} />
      </div>
    );
  } else if (kind === "json") {
    body = <CodeView doc={trimFinalNewline(truncated ? data.text : formatJson(data.text))} language="json" />;
  } else {
    body = <CodeView doc={trimFinalNewline(data.text)} language={codeLanguageOf(name)} />;
  }

  return (
    <section className="docview" aria-label={t("doc_label", { name })}>
      <header className="docview-head">
        <Icon icon={ICONS.file} size="sm" className="fico" />
        <span className="docview-name" title={doc.path}>{name}</span>
        <span className="docview-meta mono" title={doc.path}>
          {doc.path}
          {data && ` · ${formatSize(data.size)} · ${ENCODING_LABEL[data.encoding] ?? data.encoding}`}
        </span>
        <span className="docview-grow" />
        {kind === "markdown" && data && (
          <Segmented<"render" | "source">
            label={t("doc_view_mode")}
            value={mode}
            options={[
              { value: "render", label: t("doc_render") },
              { value: "source", label: t("doc_source") },
            ]}
            onChange={setMode}
          />
        )}
        <button
          type="button"
          className="docview-close"
          title={t("doc_close")}
          aria-label={t("doc_close")}
          onClick={closeDocument}
        >
          <Icon icon={ICONS.close} size="sm" />
        </button>
      </header>
      {truncated && (
        <div className="docview-trunc" role="note">
          {t("doc_truncated")}
        </div>
      )}
      <div className={"docview-body" + (data && !(kind === "markdown" && mode === "render") ? " code" : "")}>
        {body}
      </div>
    </section>
  );
}
