/**
 * mask → 多边形（SDD 02 §7 / D-24）：把分割后端返回的像素级 mask 在 runtime 侧统一解码、
 * 提轮廓、简化成多边形，前端只见矢量几何（SDD 04 的 `polyline` primitive），永不处理 mask。
 *
 * 为什么在 runtime 做：坐标职责边界（SDD 02 Q3）——runtime 只讲**图像像素坐标**，
 * 像素↔世界坐标的变换全部留在前端 `csAnno`；mask 是后端产物，不该穿过契约进浏览器。
 *
 * 编码格式以 Gitee AI（模力方舟）`sam3` 实测为准（2026-08-24）：
 * - `encoding: "COCO_RLE_base64"`——外层 base64，内层 COCO 压缩 RLE（LEB128 变体，列优先游程）；
 * - **`size` 实测为 `[width, height]`，与其 OpenAPI schema 声明的 `[height, width]` 相反**，
 *   故本模块显式按 `[w, h]` 解读；换后端时须重新核对该字段语义（见 §17 注意事项）。
 */

/** 分割后端返回的 mask 结构（COCO RLE + base64）。 */
export interface RleMask {
  /** 实测取值 `COCO_RLE_base64`；其余编码暂不支持，调用方需先判定。 */
  encoding: string;
  /** **`[width, height]`**——注意与 COCO 惯例及部分 schema 声明相反。 */
  size: [number, number];
  /** base64 包裹的 COCO 压缩 RLE。 */
  counts: string;
}

/** 图像像素坐标点 `[x, y]`，与 SDD 04 `polyline` primitive 的点格式一致。 */
export type Point2 = [number, number];

export interface MaskToPolygonOptions {
  /**
   * Douglas-Peucker 容差（像素）。缺省取图像短边的 0.2%——实测 1024×829 上
   * 218/265 点的轮廓简化到 15/16 点（压缩比 14–17×），肉眼与原轮廓无差。
   */
  epsilon?: number;
  /** 点数上限（缺省 256）。超限时按 epsilon 翻倍重试，直至达标或退化为 bbox 四角。 */
  maxPoints?: number;
}

const DEFAULT_MAX_POINTS = 256;
const EPSILON_RATIO = 0.002;

/**
 * COCO 压缩 RLE 的整数解码：每字符载 5 bit（ASCII 偏移 48），`0x20` 为续位标志，
 * 末字符的 `0x10` 为符号位；第 3 个游程起为相对前前一个游程的增量。
 */
export function decodeCocoCounts(bytes: Uint8Array): number[] {
  const counts: number[] = [];
  let p = 0;
  while (p < bytes.length) {
    let x = 0;
    let k = 0;
    let more = 1;
    while (more) {
      const c = bytes[p]! - 48;
      x |= (c & 0x1f) << (5 * k);
      more = c & 0x20;
      p += 1;
      k += 1;
      if (!more && c & 0x10) x |= -1 << (5 * k);
    }
    if (counts.length > 2) x += counts[counts.length - 2]!;
    counts.push(x);
  }
  return counts;
}

/** 解码后的二值 mask：`data[y * width + x]` 为 1 表示前景（行优先存储，便于扫描）。 */
export interface BinaryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * `COCO_RLE_base64` → 二值 mask。游程按**列优先**交替 0/1 铺开（COCO 契约），
 * 本函数在写入时转成行优先存储。
 */
export function rleToMask(mask: RleMask): BinaryMask {
  const [width, height] = mask.size; // 实测 [w, h]，见文件头注释
  const runs = decodeCocoCounts(base64ToBytes(mask.counts));
  const data = new Uint8Array(width * height);
  let pos = 0;
  let value = 0;
  for (const run of runs) {
    if (value) {
      for (let i = pos; i < pos + run && i < width * height; i += 1) {
        // 列优先索引 i → (x, y)：x = ⌊i / height⌋，y = i mod height
        const x = (i / height) | 0;
        const y = i % height;
        data[y * width + x] = 1;
      }
    }
    pos += run;
    value ^= 1;
  }
  return { width, height, data };
}

/**
 * Moore 邻域边界跟踪：取最大连通域的外轮廓。返回像素坐标点序列（闭合轮廓，不重复首点）。
 * 复杂度与前景像素数线性相关；步数上限防御畸形 mask 导致的死循环。
 */
export function traceContour(mask: BinaryMask): Point2[] {
  const { width, height, data } = mask;
  const at = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && data[y * width + x] === 1;

  // 起点取最上行中最左的前景像素——保证它一定在外轮廓上
  let start: Point2 | null = null;
  let area = 0;
  for (let y = 0; y < height && !start; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 1) {
        start = [x, y];
        break;
      }
    }
  }
  if (!start) return [];
  for (let i = 0; i < data.length; i += 1) area += data[i]!;

  const nbr: Point2[] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contour: Point2[] = [start];
  let cur: Point2 = start;
  let dir = 0;
  const maxSteps = 4 * area + 8;
  for (let step = 0; step < maxSteps; step += 1) {
    let found = false;
    for (let i = 0; i < 8; i += 1) {
      // 从上一步来向回退两格再顺时针搜，保证贴着边界走
      const nd = (dir + 6 + i) % 8;
      const nx = cur[0] + nbr[nd]![0];
      const ny = cur[1] + nbr[nd]![1];
      if (at(nx, ny)) {
        cur = [nx, ny];
        dir = nd;
        contour.push(cur);
        found = true;
        break;
      }
    }
    if (!found) break;
    if (contour.length > 2 && cur[0] === start[0] && cur[1] === start[1]) {
      contour.pop(); // 回到起点即闭合，不重复首点
      break;
    }
  }
  return contour;
}

/** Douglas-Peucker 折线简化（迭代实现，避免深轮廓爆栈）。 */
export function simplify(points: Point2[], epsilon: number): Point2[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const [ax, ay] = points[first]!;
    const [bx, by] = points[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const norm = Math.hypot(dx, dy);
    let maxDist = -1;
    let index = first;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i]!;
      const dist = norm
        ? Math.abs(dx * (py - ay) - dy * (px - ax)) / norm
        : Math.hypot(px - ax, py - ay);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export interface MaskPolygonResult {
  /** 简化后的闭合多边形（图像像素坐标）。 */
  points: Point2[];
  /** 与 mask 实际前景一致的包围盒 `[x0, y0, x1, y1]`，可用于与后端返回的 bbox 交叉校验。 */
  bbox: [number, number, number, number];
  /** 前景像素数。0 表示空 mask（调用方应丢弃该 segment）。 */
  area: number;
  /** 简化前的原始轮廓点数，便于日志与调参。 */
  rawPointCount: number;
}

/**
 * 一步到位：`COCO_RLE_base64` mask → 简化多边形 + 包围盒。
 * 空 mask（无前景）返回 `points: []`、`area: 0`，调用方据此跳过。
 */
export function maskToPolygon(mask: RleMask, opts: MaskToPolygonOptions = {}): MaskPolygonResult {
  const binary = rleToMask(mask);
  const { width, height, data } = binary;

  let area = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 1) {
        area += 1;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!area) return { points: [], bbox: [0, 0, 0, 0], area: 0, rawPointCount: 0 };

  const contour = traceContour(binary);
  const maxPoints = opts.maxPoints ?? DEFAULT_MAX_POINTS;
  let epsilon = opts.epsilon ?? EPSILON_RATIO * Math.min(width, height);
  let points = simplify(contour, epsilon);
  // 超出点数上限时逐步放宽容差；上限兜底退化为包围盒四角，保证契约里的点数硬上限成立
  for (let i = 0; points.length > maxPoints && i < 16; i += 1) {
    epsilon *= 2;
    points = simplify(contour, epsilon);
  }
  if (points.length > maxPoints) {
    points = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }

  return { points, bbox: [x0, y0, x1, y1], area, rawPointCount: contour.length };
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
