// Workbench 查看器工具条：经 useEditorChrome 装配（SDD 04 §7.5 规则 9）。
// 沿用画布浮层布局：右上工具块 = 模式 + 分隔线 + 动作；顶部居中块 = 提示 + 模式选项 + 视图。
// 读数由底部面板承载，这里不渲染读数条（D-27）。
import { useI18n } from "../i18n";
import { useSession } from "../store/session";
import { ChromeSegments, chromeHintText, hasSegments } from "../viewer/chromeSegments";
import { useEditorChrome } from "../viewer/editorChrome";
import { EditorActions } from "./EditorActions";
import { Icon } from "./Icon";
import { FALLBACK_ICON, TOOL_ICON } from "./iconMap";

export function ViewerChrome() {
  const { t, lang } = useI18n();
  const setTool = useSession((s) => s.setTool);
  const chrome = useEditorChrome();
  const hint = chromeHintText(chrome, t, lang);

  return (
    <>
      <div className="etools" role="toolbar">
        {chrome.tools.map((entry) => (
          <button key={entry.id} className="etool" aria-pressed={chrome.tool === entry.id} onClick={() => setTool(entry.id)}>
            <Icon icon={TOOL_ICON[entry.id] ?? FALLBACK_ICON} size="sm" />
            <span className="tip">{t(entry.label)}</span>
          </button>
        ))}
        {chrome.actions.length > 0 && <span className="etool-sep" aria-hidden="true" />}
        <EditorActions chrome={chrome} variant="workbench" />
      </div>
      {(hint || hasSegments(chrome)) && (
        <div className="chrome-options">
          {hint && <span className="chrome-hint">{hint}</span>}
          <ChromeSegments chrome={chrome} />
        </div>
      )}
    </>
  );
}
