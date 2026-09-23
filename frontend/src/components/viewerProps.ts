// 查看器引擎的入参（SDD 10 W3）：当前对象与焦点由 Viewer.tsx 从 store 取出后下传，
// 引擎不再自取「当前对象」。W4 由 frontend/src/viewer/contract.ts 的 ViewerProps 取代。
import type { Focus, ObjectMeta } from "../api/types";

export interface EngineProps {
  object: ObjectMeta;
  focus: Focus;
}
