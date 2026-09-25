import { useGlobalKeys } from "../../keys/globalKeys";
import { useSession } from "../../store/session";
import { AgentPanel } from "../AgentPanel";
import { ErrorBoundary } from "../ErrorBoundary";
import { Notice } from "../Notice";
import { ImagePreview } from "../ImagePreview";
import { ShortcutSheet } from "../ShortcutSheet";
import { FocusTopBar } from "./FocusTopBar";
import { SessionRail } from "./SessionRail";
import { SettingsPanel } from "./SettingsPanel";

export function ChatShell() {
  useGlobalKeys();
  // chat 发行版没有舞台与图谱，右侧只会是设置面板（左侧栏底部入口，SDD feats/01 v1.7 D23）。
  const settingsOpen = useSession((s) => s.focusLayout.rightOpen && s.focusLayout.sideView === "settings");
  return (
    <div className="focus-shell chat-shell">
      <FocusTopBar />
      <div className="focus-body">
        <SessionRail />
        <main className="chat-main">
          <ErrorBoundary label="conversation"><AgentPanel /></ErrorBoundary>
        </main>
        {settingsOpen && (
          <aside className="focus-side">
            <SettingsPanel />
          </aside>
        )}
      </div>
      <Notice />
      <ShortcutSheet />
      <ImagePreview />
    </div>
  );
}
