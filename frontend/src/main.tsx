import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./store/theme"; // 首帧前落 <html data-theme>（SDD 12）
import "./store/reading"; // 首帧前落 <html data-reading>（阅读字号档）
import "./styles/fonts.css";
import "./styles/global.css";
import "./styles/annotations.css";
import "./styles/mascot.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
