import type { ComponentType } from "react";

import type { Annotation, ClassSpec, Focus, Index, ObjectMeta, Primitive, Region, TaskView } from "../api/types";
import type { ToolOptions } from "../store/session";

export type FrameAxis =
  | { kind: "none" }
  | { kind: "z" | "t"; index: number; count: number; fps?: number; onIndex(index: number): void };

export interface FrameSource {
  objectId: string;
  imageIds(): Promise<string[]>;
  dims(): Promise<{ columns: number; rows: number; frames: number }>;
  defaultVoi?: { ww: number; wl: number };
}

export interface MaskSink {
  commit(mask: Uint8Array, dims: { columns: number; rows: number }, index: Index): Promise<void>;
}

export type Painter = (
  context: CanvasRenderingContext2D,
  primitive: Primitive,
  project: (x: number, y: number) => [number, number],
  options: { color: string; index: Index; classes?: ClassSpec[] },
) => void;

export interface ViewerProps {
  object: ObjectMeta;
  focus: Focus;
  task: TaskView | null;
  capabilities: string[];
  source: FrameSource;
  axis: FrameAxis;
  voi: { ww: number; wl: number } | null;
  primitives: Primitive[];
  annotations: Annotation[];
  tool: string;
  toolOptions: ToolOptions;
  maskSink: MaskSink;
  painters: Record<string, Painter>;
  onCoords(coords: { x: number; y: number } & Index): void;
  onRegion(region: Region): void;
  notify(tone: "info" | "crit", message: string): void;
}

export type ViewerEngine = ComponentType<ViewerProps>;

export function axisFor(object: ObjectMeta): "z" | "t" | null {
  return object.axes.find((axis) => axis.name === "z" || axis.name === "t")?.name as "z" | "t" | undefined ?? null;
}
