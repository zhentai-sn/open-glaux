import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// 表格自带滚动容器：宽表在 720px 阅读列里横向滚动，外框与圆角由 .md-table 承担；
// 文档视图若自己提供 table 覆盖，仍以传入的 components 为准。
const DEFAULT_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

// assistant 消息的 Markdown 渲染（feats/00 §5.1）。react-markdown 默认不放行原始 HTML，
// 天然免 XSS；GFM 插件补表格/删除线/任务列表。样式见 global.css 的 .md 段。
// ``components`` 可选：文档视图借此覆盖链接与图片（SDD 14 §7.3 规则 7），对话气泡不传。
export function Markdown({ text, components }: { text: string; components?: Components }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...DEFAULT_COMPONENTS, ...components }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
