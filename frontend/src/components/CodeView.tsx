import { useEffect, useRef, useState } from "react";

// 只读代码视图（SDD 14 §7.3 规则 4～6、D-5）：CodeMirror 6 与语言包一律在 effect 里动态 import()，
// 不进入入口分块；颜色全部取主题 CSS 变量，随深浅主题切换（SDD 12）。语言包加载失败时不带语言
// 扩展建编辑器，正文照常显示（§13）；核心包也加载失败时退回纯文本 <pre>。

export type CodeLanguage = "python" | "json" | "markdown" | "yaml" | "javascript" | "jsx" | "typescript" | "tsx";

const LANGUAGE_BY_EXT: Record<string, CodeLanguage> = {
  py: "python",
  json: "json",
  ipynb: "json",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
};

/** 文件扩展名（小写，不含点）；无扩展名为空串。 */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 按扩展名选语法高亮（大小写不敏感）；其余不高亮。 */
export function codeLanguageOf(name: string): CodeLanguage | null {
  return LANGUAGE_BY_EXT[extensionOf(name)] ?? null;
}

async function loadCore() {
  const [state, view, language, search, highlight] = await Promise.all([
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@codemirror/search"),
    import("@lezer/highlight"),
  ]);
  return { state, view, language, search, highlight };
}

type Core = Awaited<ReturnType<typeof loadCore>>;
type Extension = import("@codemirror/state").Extension;

async function loadLanguage(lang: CodeLanguage): Promise<Extension> {
  switch (lang) {
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true });
  }
}

function extensions(cm: Core, lang: Extension | null): Extension[] {
  const { EditorState } = cm.state;
  const { EditorView, lineNumbers, highlightSpecialChars, keymap } = cm.view;
  const { HighlightStyle, syntaxHighlighting } = cm.language;
  const { search, searchKeymap } = cm.search;
  const t = cm.highlight.tags;

  const theme = EditorView.theme({
    "&": { height: "100%", color: "var(--ink)", backgroundColor: "var(--editor)", fontSize: "12.5px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
    ".cm-content": { caretColor: "transparent" },
    ".cm-gutters": { color: "var(--faint)", backgroundColor: "var(--editor)", borderRight: "1px solid var(--line)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px" },
    ".cm-specialChar": { color: "var(--crit)" },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--warn) 28%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--warn) 55%, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--accent2) 40%, transparent)" },
    ".cm-panels": { color: "var(--ink)", backgroundColor: "var(--sidebar)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
    ".cm-panel.cm-search": { fontFamily: "var(--sans)", fontSize: "12px" },
    ".cm-textfield": {
      color: "var(--ink)",
      backgroundColor: "var(--input)",
      border: "1px solid var(--line2)",
      borderRadius: "4px",
    },
    ".cm-button": {
      color: "var(--ink)",
      backgroundImage: "none",
      backgroundColor: "var(--tab)",
      border: "1px solid var(--line2)",
      borderRadius: "4px",
    },
    ".cm-panel.cm-search [name=close]": { color: "var(--mid)" },
  });

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--agent)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--good)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--ma)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--faint)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--li)" },
    { tag: [t.typeName, t.className, t.namespace], color: "var(--roi)" },
    { tag: [t.propertyName, t.attributeName], color: "var(--li)" },
    { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--warn)" },
    { tag: t.heading, color: "var(--bright)", fontWeight: "bold" },
    { tag: [t.link, t.url], color: "var(--accent2)" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.operator, t.punctuation, t.separator], color: "var(--mid)" },
    { tag: t.invalid, color: "var(--crit)" },
  ]);

  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    // 不可编辑时内容区默认不可聚焦，Ctrl+F 无处接收；显式给 tabindex 使查找可用
    EditorView.contentAttributes.of({ tabindex: "0" }),
    lineNumbers(),
    highlightSpecialChars(),
    search({ top: true }),
    keymap.of(searchKeymap),
    syntaxHighlighting(highlight),
    theme,
    ...(lang ? [lang] : []),
  ];
}

export function CodeView({ doc, language }: { doc: string; language: CodeLanguage | null }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [failed, setFailed] = useState(false);

  // 语言变化即重建编辑器；卸载时 destroy
  useEffect(() => {
    let alive = true;
    let view: import("@codemirror/view").EditorView | null = null;
    void (async () => {
      let cm: Core;
      try {
        cm = await loadCore();
      } catch {
        if (alive) setFailed(true);
        return;
      }
      let lang: Extension | null = null;
      if (language) {
        try {
          lang = await loadLanguage(language);
        } catch {
          lang = null; // §13：语言包加载失败 → 无高亮
        }
      }
      if (!alive || !host.current) return;
      view = new cm.view.EditorView({
        state: cm.state.EditorState.create({ doc: docRef.current, extensions: extensions(cm, lang) }),
        parent: host.current,
      });
      viewRef.current = view;
    })();
    return () => {
      alive = false;
      view?.destroy();
      viewRef.current = null;
    };
  }, [language]);

  // 正文变化整体替换（readOnly 只拦用户输入，不拦程序 dispatch）
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === doc) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
  }, [doc]);

  if (failed) return <pre className="codeview codeview-plain">{doc}</pre>;
  return <div ref={host} className="codeview" />;
}
