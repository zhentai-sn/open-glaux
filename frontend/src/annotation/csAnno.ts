// CS3D 标注层 ↔ Annotation 契约桥（raster_2d / volume_3d 共用，SDD 04 §6.1/§6.4）。
// 分工：CS3D 标注层承担 bbox/polygon 的**渲染与交互**（移动/缩放/顶点编辑，工具包原生）；
// 本模块承担与 /annotations 的同步——事件 → annotationBridge → store，以及 store → CS3D 回灌。
// 写库一律经 annotationBridge（序号守卫/回滚范式仅此一份）；本模块只维护两侧 id 映射。
import { eventTarget, utilities as csCoreUtils, type Types as CoreTypes } from "@cornerstonejs/core";
import {
  Enums as ToolEnums,
  PlanarFreehandROITool,
  RectangleROITool,
  annotation,
  type Types as ToolTypes,
} from "@cornerstonejs/tools";

import { createAnnotation, patchAnnotation, removeAnnotation } from "./bridge";
import type { Annotation, AnnotationPrimitive } from "../api/types";

type CsAnn = ToolTypes.Annotation;
type Point3 = CoreTypes.Point3;

// --- id 映射：CS3D annotationUID ↔ 服务端 annotation id ------------------------
const csToSrv = new Map<string, string>();
const srvToCs = new Map<string, string>();
// 静默删除集合：sync 主动移除 CS3D 标注时屏蔽 REMOVED 事件回打服务端
const silentRemove = new Set<string>();
// 绘制完成待落库：防 sync 回灌与 COMPLETED 事件重复添加
const pendingCs = new Set<string>();

/** 测试/切对象复位：清全部映射（CS3D 侧标注由调用方 removeAllAnnotations）。 */
export function resetCsAnnoBridge(): void {
  csToSrv.clear();
  srvToCs.clear();
  silentRemove.clear();
  pendingCs.clear();
}

// --- 坐标换算（imageId 相关：world ↔ image px）--------------------------------

function toWorld(imageId: string, x: number, y: number): Point3 {
  return csCoreUtils.imageToWorldCoords(imageId, [x, y] as CoreTypes.Point2) as Point3;
}
function toImage(imageId: string, w: Point3): [number, number] {
  const [x, y] = csCoreUtils.worldToImageCoords(imageId, w) as CoreTypes.Point2;
  return [x, y];
}

// --- CS3D annotation → 契约原语 ------------------------------------------------

export function csToPrimitive(ann: CsAnn, imageId: string): AnnotationPrimitive | null {
  const toolName = ann.metadata?.toolName;
  if (toolName === RectangleROITool.toolName) {
    const pts = (ann.data?.handles as { points?: Point3[] } | undefined)?.points;
    if (!pts || pts.length < 2) return null;
    const [ax, ay] = toImage(imageId, pts[0]);
    const [bx, by] = toImage(imageId, pts[1]);
    const x0 = Math.min(ax, bx);
    const y0 = Math.min(ay, by);
    const x1 = Math.max(ax, bx);
    const y1 = Math.max(ay, by);
    if (!(x1 > x0) || !(y1 > y0)) return null;
    return { kind: "bbox", x0, y0, x1, y1 };
  }
  if (toolName === PlanarFreehandROITool.toolName) {
    const contour = (ann.data as { contour?: { points?: Point3[] } } | undefined)?.contour;
    const pts = contour?.points;
    if (!pts || pts.length < 3) return null;
    return { kind: "polyline", closed: true, points: pts.map((p) => toImage(imageId, p)) };
  }
  return null;
}

// --- 契约原语 → CS3D annotation（reload/切对象回灌）-----------------------------

export function primitiveToCs(a: Annotation, imageId: string, frameOfReferenceId: string): CsAnn | null {
  const p = a.primitive;
  const base = {
    annotationUID: csCoreUtils.uuidv4() as string,
    metadata: {
      toolName: "",
      FrameOfReferenceId: frameOfReferenceId,
      referencedImageId: imageId,
    },
    isLocked: false,
    isVisible: true,
    invalidated: false,
  };
  if (p.kind === "bbox") {
    return {
      ...base,
      metadata: { ...base.metadata, toolName: RectangleROITool.toolName },
      data: {
        handles: {
          points: [toWorld(imageId, p.x0, p.y0), toWorld(imageId, p.x1, p.y1)],
          activeHandleIndex: null,
          textBox: { hasMoved: false, worldPosition: toWorld(imageId, p.x1, p.y0) },
        },
        cachedStats: {},
      },
    } as unknown as CsAnn;
  }
  if (p.kind === "polyline" && p.closed) {
    return {
      ...base,
      metadata: { ...base.metadata, toolName: PlanarFreehandROITool.toolName },
      data: {
        handles: {
          points: [],
          activeHandleIndex: null,
          textBox: { hasMoved: false, worldPosition: toWorld(imageId, p.points[0][0], p.points[0][1]) },
        },
        contour: { type: "ClosedContour", points: p.points.map(([x, y]) => toWorld(imageId, x, y)) },
        cachedStats: {},
      },
    } as unknown as CsAnn;
  }
  return null; // mask 走叠色渲染，不进 CS3D 标注层
}

/** store.annotations → CS3D 标注层 reconcile（增缺删旧；tmp 草稿与 mask 不下发）。 */
export function syncCsAnnotations(
  annotations: Annotation[],
  imageId: string,
  frameOfReferenceId: string,
  selector: string,
): void {
  const want = new Set(annotations.filter((a) => !a.id.startsWith("tmp-")).map((a) => a.id));
  // 删：服务端已不存在的（切对象/删除回流）
  for (const [srvId, csId] of [...srvToCs]) {
    if (!want.has(srvId)) {
      silentRemove.add(csId);
      annotation.state.removeAnnotation(csId);
      srvToCs.delete(srvId);
      csToSrv.delete(csId);
    }
  }
  // 增：store 有而 CS3D 层没有的（reload/拉取回灌）
  for (const a of annotations) {
    if (a.id.startsWith("tmp-") || srvToCs.has(a.id)) continue;
    const cs = primitiveToCs(a, imageId, frameOfReferenceId);
    if (!cs) continue;
    const csId = annotation.state.addAnnotation(cs, selector);
    srvToCs.set(a.id, csId);
    csToSrv.set(csId, a.id);
  }
}

// --- 事件桥：COMPLETED / MODIFIED / REMOVED → annotationBridge ------------------

export interface CsAnnoBridgeOpts {
  getImageId: () => string | null;
  /** imageId → 落库目标（raster：web: 去前缀；volume：解析 nifti url 得 volume id + z）。 */
  toTarget?: (imageId: string) => { image_id: string; z?: number | null };
}

/**
 * 挂 CS3D 标注事件 → bridge。返回 detach。
 * MODIFIED 用 300ms 防抖收敛拖拽中间态（只对最后一次几何提交 patch）。
 */
export function attachCsAnnoBridge(opts: CsAnnoBridgeOpts): () => void {
  const modTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // 事件 detail 无 viewportId 字段——按标注的 referencedImageId 归属当前对象过滤
  const inScope = (ann: CsAnn | undefined): ann is CsAnn & { annotationUID: string } => {
    if (!ann || !ann.annotationUID) return false;
    const cur = opts.getImageId();
    const ref = ann.metadata?.referencedImageId;
    return !cur || !ref || ref === cur;
  };

  const onCompleted = (e: Event) => {
    const ann = (e as CustomEvent<{ annotation?: CsAnn }>).detail?.annotation;
    if (!inScope(ann)) return;
    if (csToSrv.has(ann.annotationUID)) return; // 回灌的标注不再走创建
    const imageId = opts.getImageId();
    if (!imageId) return;
    const prim = csToPrimitive(ann, imageId);
    if (!prim) {
      annotation.state.removeAnnotation(ann.annotationUID);
      return;
    }
    pendingCs.add(ann.annotationUID);
    const target = (opts.toTarget ?? defaultTarget)(imageId);
    void createAnnotation({ ...target, primitive: prim }).then((saved) => {
      pendingCs.delete(ann.annotationUID);
      if (saved) {
        csToSrv.set(ann.annotationUID, saved.id);
        srvToCs.set(saved.id, ann.annotationUID);
      } else {
        // 落库失败（422/网络）——CS3D 层同步移除，画布与 store 一致
        silentRemove.add(ann.annotationUID);
        annotation.state.removeAnnotation(ann.annotationUID);
      }
    });
  };

  const onModified = (e: Event) => {
    const ann = (e as CustomEvent<{ annotation?: CsAnn }>).detail?.annotation;
    if (!inScope(ann)) return;
    const srvId = csToSrv.get(ann.annotationUID);
    if (!srvId) return;
    const prev = modTimers.get(ann.annotationUID);
    if (prev) clearTimeout(prev);
    modTimers.set(
      ann.annotationUID,
      setTimeout(() => {
        modTimers.delete(ann.annotationUID);
        const imageId = opts.getImageId();
        if (!imageId) return;
        const prim = csToPrimitive(ann, imageId);
        const local = useSessionAnnotations().find((a) => a.id === srvId);
        if (!prim || !local) return;
        void patchAnnotation(srvId, local.seq, { primitive: prim });
      }, 300),
    );
  };

  const onRemoved = (e: Event) => {
    const ann = (e as CustomEvent<{ annotation?: CsAnn }>).detail?.annotation;
    if (!inScope(ann)) return;
    const csId = ann.annotationUID;
    if (!csId) return;
    if (silentRemove.has(csId)) {
      silentRemove.delete(csId);
      return;
    }
    const srvId = csToSrv.get(csId);
    if (!srvId) return;
    csToSrv.delete(csId);
    srvToCs.delete(srvId);
    const local = useSessionAnnotations().find((a) => a.id === srvId);
    if (local) void removeAnnotation(srvId, local.seq);
  };

  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED as unknown as string, onCompleted);
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_MODIFIED as unknown as string, onModified);
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_REMOVED as unknown as string, onRemoved);
  return () => {
    for (const t of modTimers.values()) clearTimeout(t);
    modTimers.clear();
    eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_COMPLETED as unknown as string, onCompleted);
    eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_MODIFIED as unknown as string, onModified);
    eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_REMOVED as unknown as string, onRemoved);
  };
}

// 默认落库目标：web: 方案去前缀（raster_2d）
function defaultTarget(imageId: string): { image_id: string; z?: number | null } {
  return { image_id: imageId.replace(/^web:/, "") };
}

/** volume_3d 落库目标解析器：`nifti:<url>#z=<n>` → { image_id: volume id, z }。 */
export function niftiTarget(imageId: string): { image_id: string; z?: number | null } {
  const zm = /#z=(\d+)$/.exec(imageId);
  const z = zm ? Number(zm[1]) : null;
  // volume id 取 URL 末段（/volume/<id>），去 nifti: 前缀与 #z 后缀
  const path = imageId.replace(/^nifti:/, "").replace(/#z=\d+$/, "");
  const seg = path.split("/").filter(Boolean);
  return { image_id: seg[seg.length - 1] ?? path, z };
}

// 延迟引用 store（避免模块循环）
import { useSession } from "../store/session";
function useSessionAnnotations(): Annotation[] {
  return useSession.getState().annotations;
}
