import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Blocks,
  Brush,
  BookMarked,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircuitBoard,
  Crosshair,
  Database,
  Diamond,
  Eye,
  EyeOff,
  File,
  Files,
  Folder,
  History,
  Image,
  Loader2,
  Menu,
  MousePointer2,
  PanelLeft,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Settings,
  Sparkles,
  Spline,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";

import type { Tool } from "../store/session";

// 领域概念 → 图标（SDD feats/06 §5）——单一真相源；渲染点不内联散写。
// 未知键回退 FALLBACK_ICON（替代旧 ◇），不崩不空白。
export const FALLBACK_ICON: LucideIcon = Diamond;

// 工具（当前 IMT 集；随 SDD 04 工具集迁移，与 SDD 05 键位映射同源，D-2）
// SDD 04 统一工具集（cursor/bbox/polygon/brush/reset）× SDD 06 线性图标。
// 旧的 editli/editma 已并入 polygon 语义，故不再各占一枚图标。
export const TOOL_ICON: Record<Tool, LucideIcon> = {
  cursor: MousePointer2,
  bbox: Square, // 框选
  polygon: Spline, // 多边形/壁线轮廓
  brush: Brush, // 涂抹（掩膜）
  reset: RotateCcw,
};

// 能力类型（插件市场四层）
export const KIND_ICON: Record<string, LucideIcon> = {
  skill: Sparkles,
  model: CircuitBoard,
  adapter: Boxes,
  dataset: Database,
  reference_method: Scale,
  calibration_source: Crosshair,
  connector: ArrowLeftRight,
  mcp: Plug,
  knowledge_base: BookMarked,
  correction_store: History,
};

// Focus 右侧栏标签
export const TAB_ICON = { stage: Image, files: Files, atlas: BookOpen } as const;

// 通用动作 / 结构图标
export const ICONS = {
  close: X,
  edit: Pencil,
  config: Settings,
  folder: Folder,
  file: File,
  explorer: Files,
  market: Blocks,
  run: Play,
  rail: PanelLeft,
  menu: Menu,
  plus: Plus,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  check: Check,
  eye: Eye,
  eyeOff: EyeOff,
  warning: AlertTriangle,
  spinner: Loader2,
  atlas: BookOpen,
  skill: Sparkles,
  swap: ArrowLeftRight,
  send: ArrowUp,
  back: ArrowLeft,
  regenerate: RefreshCw,
  archive: Archive,
} as const;
