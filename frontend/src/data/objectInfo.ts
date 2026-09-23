// 从 ObjectMeta 取展示所需信息的纯函数——组件不读过渡字段 cf / voxel_spacing_mm / mpp_um / dims
// （SDD 10 §7 规则 8），一律经 axes / calibration 取值。
import type { DataSource, ObjectMeta } from "../api/types";

/** 某轴的尺寸；该轴不存在 → null。 */
export function axisSize(obj: ObjectMeta | null, name: "x" | "y" | "z" | "t" | "level"): number | null {
  return obj?.axes.find((a) => a.name === name)?.size ?? null;
}

/** mm/px 标定值；对象无标定或标定不是 mm_per_px → null。 */
export function mmPerPx(obj: ObjectMeta | null): number | null {
  const c = obj?.calibration;
  return c?.kind === "mm_per_px" && typeof c.value === "number" ? c.value : null;
}

/** 该对象所属的数据源。 */
export function datasourceOf(datasources: DataSource[], obj: ObjectMeta | null): DataSource | null {
  return obj ? (datasources.find((d) => d.id === obj.source_id) ?? null) : null;
}

/** 展示名：display_name 为空时回退到 id（SDD 10 §9.3，不拼数据集名）。 */
export function displayName(obj: ObjectMeta): string {
  return obj.display_name || obj.id;
}
