/**
 * SDD 22 §7.2：一次命令内的视图登记。每次成功看图登记一个 `v1`、`v2`…，保存其 `ReferenceFrame`，
 * 供 `propose_annotation` / `revise_annotation` 按「照着哪张图画的」换算坐标。命令结束即随 `run` 对象释放。
 */
import type { ReferenceFrame, ViewerContext } from "../../contracts.js";
import { toObjectPoint } from "../../observation/index.js";

export type Box = [number, number, number, number];

/** 当前对象的平面像素尺寸 [宽, 高]；查看器上下文没给出时为 undefined。 */
export function objectSize(viewer: ViewerContext): [number, number] | undefined {
  const axes = viewer.object?.axes;
  const w = axes?.find((axis) => axis.name === "x")?.size;
  const h = axes?.find((axis) => axis.name === "y")?.size;
  return w && h ? [w, h] : undefined;
}

/**
 * 视图像素 → 对象像素，并截到对象范围（SDD 22 §7.2）。缩小视图的宽高取整后反算会略越过对象边缘，
 * 模型贴着图边画的点也可能落在图外；两者都按图边处理，不让 backend 以越界拒收。
 */
export function viewPointToObject(point: [number, number], frame: ReferenceFrame, size: [number, number] | undefined): [number, number] {
  const [x, y] = toObjectPoint(point, frame);
  if (!size) return [x, y];
  return [Math.min(Math.max(x, 0), size[0]), Math.min(Math.max(y, 0), size[1])];
}

export interface RegisteredView {
  id: string;
  frame: ReferenceFrame;
  /** 对象坐标；null 表示全图。 */
  region: Box | null;
}

export class ViewRegistry {
  private readonly views = new Map<string, RegisteredView>();
  private last: RegisteredView | undefined;

  add(frame: ReferenceFrame, region: Box | null): RegisteredView {
    const view = { id: `v${this.views.size + 1}`, frame, region };
    this.views.set(view.id, view);
    this.last = view;
    return view;
  }

  get(id: string): RegisteredView | undefined {
    return this.views.get(id);
  }

  latest(): RegisteredView | undefined {
    return this.last;
  }
}

const registries = new WeakMap<object, ViewRegistry>();

/** 按命令（`HarnessToolContext.run` 对象）取登记表；没有命令上下文时给一个独立的新表。 */
export function viewRegistryFor(run: object | undefined): ViewRegistry {
  if (!run) return new ViewRegistry();
  let registry = registries.get(run);
  if (!registry) {
    registry = new ViewRegistry();
    registries.set(run, registry);
  }
  return registry;
}
