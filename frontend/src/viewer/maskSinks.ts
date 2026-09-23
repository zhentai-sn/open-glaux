import { ApiError, api } from "../api/client";
import type { Index, Measure, TaskView } from "../api/types";
import { createAnnotation } from "../annotation/bridge";
import { maskToPng } from "./maskPng";
import type { MaskSink } from "./contract";

export function annotationMaskSink(objectId: string): MaskSink {
  return {
    async commit(mask, dims, index) {
      const saved = await createAnnotation({
        image_id: objectId,
        index,
        z: index.z ?? null,
        primitive: { kind: "mask" },
        mask_png_b64: maskToPng(mask, dims.columns, dims.rows),
      });
      if (!saved) throw new Error("annotation mask commit failed");
    },
  };
}

interface EditMaskOptions {
  objectId: string;
  task: TaskView;
  method: () => string;
  brush: () => { classId: number; mode: "paint" | "erase" };
  onSaved: (response: { metrics: Record<string, Measure>; labelmap_ref: string; seq: number }) => Promise<void>;
  notify: (message: string) => void;
}

/** 一个对象的一条乐观并发编辑序列；组件切对象时重建。 */
export function editMaskSink(options: EditMaskOptions): MaskSink {
  let baseSeq = 0;
  let requestSeq = 0;
  return {
    async commit(mask: Uint8Array, dims: { columns: number; rows: number }, index: Index) {
      const method = options.method();
      const { classId, mode } = options.brush();
      const mySeq = ++requestSeq;
      try {
        const response = await api.objectEdits(options.objectId, {
          task: options.task.task,
          method,
          base_seq: baseSeq,
          ops: [{ index, class_id: classId, mode, mask_png: maskToPng(mask, dims.columns, dims.rows) }],
        });
        if (mySeq !== requestSeq) return;
        baseSeq = response.seq;
        try {
          await options.onSaved(response);
        } catch {
          options.notify("编辑已保存，但叠加刷新失败；请重新打开对象查看最新结果");
        }
      } catch (error) {
        if (mySeq !== requestSeq) return;
        options.notify(error instanceof ApiError && error.status === 409
          ? "编辑冲突：labelmap 已被其他编辑超越，请刷新后重试"
          : "画笔编辑未生效（后端失败），已丢弃本次修正");
        throw error;
      }
    },
  };
}
