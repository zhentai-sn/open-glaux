import { useState } from "react";
import { useGlobalKeys } from "../../keys/globalKeys";
import { AgentPanel } from "../AgentPanel";
import { ErrorBoundary } from "../ErrorBoundary";
import { Notice } from "../Notice";
import { ImagePreview } from "../ImagePreview";
import { ShortcutSheet } from "../ShortcutSheet";
import { FocusTopBar } from "./FocusTopBar";
import { SessionRail } from "./SessionRail";

export function ChatShell() {
  useGlobalKeys();
  const [configOpen, setConfigOpen] = useState(false);
  return (
    <div className="focus-shell chat-shell">
      <FocusTopBar configOpen={configOpen} onConfigToggle={setConfigOpen} />
      <div className="focus-body">
        <SessionRail />
        <main className="chat-main">
          <ErrorBoundary label="conversation"><AgentPanel /></ErrorBoundary>
        </main>
      </div>
      <Notice />
      <ShortcutSheet />
      <ImagePreview />
    </div>
  );
}
