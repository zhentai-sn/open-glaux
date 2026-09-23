import { api } from "../api/client";
import type { ObjectMeta } from "../api/types";
import type { FrameSource } from "./contract";
import { csReady, preloadDims } from "./cornerstone";
import { niftiReady, preloadNiftiDims } from "./nifti";

const FRAME_SIZE = 4096; // 后端 /frame 允许的最长边上限（SDD 10 §5.2）

export async function registerFrameLoader(kind: ObjectMeta["kind"]): Promise<void> {
  await csReady();
  if (kind === "volume") await niftiReady();
}

export function frameSourceFor(object: ObjectMeta): FrameSource {
  const objectId = object.id;
  if (object.kind === "volume") {
    if (!object.resources.raw) throw new Error(`对象 ${objectId} 缺少 raw 资源`);
    const base = `nifti:${api.resourceUrl(object.resources.raw)}`;
    return {
      objectId,
      async dims() {
        const { columns, rows, slices } = await preloadNiftiDims(base);
        return { columns, rows, frames: slices };
      },
      async imageIds() {
        const { slices } = await preloadNiftiDims(base);
        return Array.from({ length: slices }, (_, z) => `${base}#z=${z}`);
      },
      defaultVoi: { ww: 400, wl: 40 },
    };
  }

  const axis = object.axes.find((item) => item.name === "t");
  const frames = axis?.size ?? 1;
  const imageId = (index: number) => {
    const separator = object.resources.frame.includes("?") ? "&" : "?";
    const query = `${axis ? `t=${index}&` : ""}size=${FRAME_SIZE}`;
    return `web:${api.resourceUrl(`${object.resources.frame}${separator}${query}`)}`;
  };
  return {
    objectId,
    async dims() {
      const { columns, rows } = await preloadDims(imageId(0));
      return { columns, rows, frames };
    },
    async imageIds() {
      return Array.from({ length: frames }, (_, index) => imageId(index));
    },
  };
}
