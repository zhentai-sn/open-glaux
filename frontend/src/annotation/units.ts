// 面积与长度的显示格式（SDD 23 §7.3 规则 3）：三位有效数字；µm² 达到 10⁶ 换算为 mm²。

const SQUARE: Record<string, string> = { px2: "px²", mm2: "mm²", um2: "µm²" };
const LINEAR: Record<string, string> = { px: "px", mm: "mm", um: "µm" };

function sig3(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString("en-US");
  return Number(n.toPrecision(3)).toString();
}

export function formatArea(area: number, areaUnit: string): string {
  if (areaUnit === "um2" && Math.abs(area) >= 1e6) return `${sig3(area / 1e6)} mm²`;
  return `${sig3(area)} ${SQUARE[areaUnit] ?? areaUnit}`;
}

export function formatLength(length: number, unit: string): string {
  if (unit === "um" && Math.abs(length) >= 1e3) return `${sig3(length / 1e3)} mm`;
  return `${sig3(length)} ${LINEAR[unit] ?? unit}`;
}
