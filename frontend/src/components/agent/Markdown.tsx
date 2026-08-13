import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// assistant 消息的 Markdown 渲染（feats/00 §5.1）。react-markdown 默认不放行原始 HTML，
// 天然免 XSS；GFM 插件补表格/删除线/任务列表。样式见 global.css 的 .md 段。
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
