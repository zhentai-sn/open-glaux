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
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";

import type { Tool } from "../store/session";

// 领域概念 → 图标（SDD feats/06 §5）——单一真相源；渲染点不内联散写。
// 未知键回退 FALLBACK_ICON（替代旧 ◇），不崩不空白。
export const FALLBACK_ICON: LucideIcon = Diamond;

// 工具（与 SDD 05 键位映射同源，D-2）× SDD 06 线性图标。
// SDD 04 统一工具集（cursor/bbox/polygon/brush/reset）+ 任务专属编辑 wall（IMT 壁线）：
// 旧的 editli/editma 曾并入 polygon，现由 wall 单独承接（polygon 归还给自由多边形）。
export const TOOL_ICON: Partial<Record<Tool, LucideIcon>> = {
  cursor: MousePointer2,
  bbox: Square, // 框选
  polygon: Spline, // 自由多边形轮廓
  wall: Waves, // 壁线形变（LI/MA 双线）
  brush: Brush, // 涂抹（掩膜）
  reset: RotateCcw,
};

// 能力类型（插件市场四要素）
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
  annotation: Square, // 建议标注卡片（SDD 02）——与工具栏的 bbox 同形，指向同一概念
  skill: Sparkles,
  swap: ArrowLeftRight,
  send: ArrowUp,
  back: ArrowLeft,
  regenerate: RefreshCw,
  archive: Archive,
} as const;
