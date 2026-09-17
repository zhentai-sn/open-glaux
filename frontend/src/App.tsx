import { lazy, Suspense } from "react";
import { CHAT_EDITION } from "./edition";
import { ChatShell } from "./components/focus/ChatShell";

const ResearchApp = lazy(() => import("./ResearchApp").then((m) => ({ default: m.ResearchApp })));

export function App() {
  return CHAT_EDITION ? <ChatShell /> : <Suspense fallback={null}><ResearchApp /></Suspense>;
}
