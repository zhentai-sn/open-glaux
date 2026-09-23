// 测试夹具：按 SDD 10 §9.1 补齐 ObjectMeta / TaskView / DataSource 的新字段，
// 让用例只写自己关心的字段。模态 → 几何族的对照只在测试里出现（夹具登记，不是产品分支）。
import type { DataSource, Modality, ObjectKind, ObjectMeta, TaskView } from "../api/types";

export const KIND_OF: Record<string, ObjectKind> = {
  carotid_imt: "image",
  fetal_hc: "image",
  ct_abdomen: "volume",
  pathology: "slide",
  natural_image: "image",
  video: "video",
};

const AXES: Record<ObjectKind, ObjectMeta["axes"]> = {
  image: [{ name: "x", size: 640 }, { name: "y", size: 480 }],
  volume: [{ name: "x", size: 64 }, { name: "y", size: 64 }, { name: "z", size: 32 }],
  slide: [{ name: "x", size: 4096 }, { name: "y", size: 4096 }, { name: "level", size: 3 }],
  video: [{ name: "x", size: 64 }, { name: "y", size: 48 }, { name: "t", size: 12 }],
};

/** 一个对象元数据；`cf` 若给出则同时写成 mm_per_px 标定（与后端回填一致）。 */
export function objectMeta(p: Partial<ObjectMeta> & { id: string; modality: Modality }): ObjectMeta {
  const kind = p.kind ?? KIND_OF[p.modality] ?? "image";
  const cf = p.cf ?? null;
  return {
    kind,
    source_id: "test-source",
    display_name: "",
    axes: AXES[kind],
    calibration: cf != null ? { kind: "mm_per_px", value: cf, source: "test" } : null,
    resources: { frame: `/objects/${p.id}/frame` },
    streams: [],
    methods: [],
    meta: {},
    ...p,
  };
}

/** TaskView 的 SDD 10 新字段（几何族 + 触发策略）。 */
export function taskFields(modality: string): Pick<TaskView, "object_kinds" | "trigger"> {
  const kind = KIND_OF[modality] ?? "image";
  return { object_kinds: [kind], trigger: kind === "slide" ? "on_region" : "on_open" };
}

/** DataSource 的 SDD 10 新字段。 */
export function dsFields(modality: string): Pick<
  DataSource,
  "kind" | "label" | "label_key" | "importable" | "default_capabilities"
> {
  return {
    kind: KIND_OF[modality] ?? "image",
    label: modality,
    label_key: `modality.${modality}`,
    importable: [],
    default_capabilities: [],
  };
}
