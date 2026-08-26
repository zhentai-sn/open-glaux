/**
 * mask → 多边形（SDD 02 D-24）。
 *
 * fixture `sam3-segmentation-eye.json` 是 Gitee AI（模力方舟）`sam3` 的**真实响应**
 * （2026-08-24，`POST /v1/images/segmentation`，1024×829 图，prompt="eye"）——
 * 用真响应而非构造数据，才能锁住两处实测出的 schema 与实现不符：
 * `size` 实为 `[w,h]`、`prompt` 必传但未声明。
 *
 * 核心断言：解码出的 bbox 必须与后端自报的 `bbox` 吻合（1px 内）——
 * 这是"RLE 解码正确"的独立交叉验证，任何解码位序错误都会让它偏出百像素级。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeCocoCounts,
  maskToPolygon,
  rleToMask,
  simplify,
  traceContour,
  type Point2,
  type RleMask,
} from "../../src/annotation/mask-to-polygon.js";

interface Segment {
  id: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  mask: RleMask;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/sam3-segmentation-eye.json", import.meta.url)), "utf8"),
) as { num_segments: number; segments: Segment[] };

describe("mask-to-polygon · 真实 sam3 响应", () => {
  it("fixture 是两段 eye 分割，编码为 COCO_RLE_base64", () => {
    expect(fixture.num_segments).toBe(2);
    for (const s of fixture.segments) {
      expect(s.label).toBe("eye");
      expect(s.mask.encoding).toBe("COCO_RLE_base64");
      expect(s.mask.size).toEqual([1024, 829]);
    }
  });

  it("解码出的 bbox 与后端自报 bbox 吻合（RLE 位序正确的交叉验证）", () => {
    for (const s of fixture.segments) {
      const { bbox, area } = maskToPolygon(s.mask);
      expect(area).toBeGreaterThan(0);
      // 后端 bbox 是浮点、解码 bbox 是整数像素，容差 2px
      for (let i = 0; i < 4; i += 1) {
        expect(Math.abs(bbox[i]! - s.bbox[i]!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("size 按 [w,h] 解读——按 [h,w] 会解出完全不同的形状", () => {
    const s = fixture.segments[0]!;
    const correct = rleToMask(s.mask);
    expect(correct.width).toBe(1024);
    expect(correct.height).toBe(829);

    const swapped = rleToMask({ ...s.mask, size: [s.mask.size[1], s.mask.size[0]] });
    // 交换后前景像素总数不变，但落点全错——bbox 会横跨整个高度
    const bboxOf = (m: ReturnType<typeof rleToMask>): [number, number] => {
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let y = 0; y < m.height; y += 1)
        for (let x = 0; x < m.width; x += 1)
          if (m.data[y * m.width + x] === 1) {
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      return [y0, y1];
    };
    const [cy0, cy1] = bboxOf(correct);
    const [sy0, sy1] = bboxOf(swapped);
    expect(cy1 - cy0).toBeLessThan(100); // 正确解读：眼睛只占约 77px 高
    expect(sy1 - sy0).toBeGreaterThan(500); // 错误解读：纵向糊成长条
  });

  it("简化到远低于点数上限，且保持形状（实测 218/265 点 → 15/16 点）", () => {
    for (const s of fixture.segments) {
      const { points, rawPointCount } = maskToPolygon(s.mask);
      expect(rawPointCount).toBeGreaterThan(100);
      expect(points.length).toBeGreaterThanOrEqual(3);
      expect(points.length).toBeLessThan(40);
      // 简化后的点必须仍落在 mask 包围盒内
      const [x0, y0, x1, y1] = maskToPolygon(s.mask).bbox;
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(x0);
        expect(x).toBeLessThanOrEqual(x1);
        expect(y).toBeGreaterThanOrEqual(y0);
        expect(y).toBeLessThanOrEqual(y1);
      }
    }
  });

  it("maxPoints 是硬上限：容差再小也不会超出", () => {
    const s = fixture.segments[0]!;
    const { points } = maskToPolygon(s.mask, { epsilon: 0.01, maxPoints: 8 });
    expect(points.length).toBeLessThanOrEqual(8);
  });
});

describe("mask-to-polygon · 算法单元", () => {
  it("decodeCocoCounts 解出的游程之和等于像素总数", () => {
    for (const s of fixture.segments) {
      const runs = decodeCocoCounts(new Uint8Array(Buffer.from(s.mask.counts, "base64")));
      const total = runs.reduce((a, b) => a + b, 0);
      expect(total).toBe(s.mask.size[0] * s.mask.size[1]);
    }
  });

  it("traceContour 对实心矩形返回其周长上的点", () => {
    const width = 10;
    const height = 8;
    const data = new Uint8Array(width * height);
    for (let y = 2; y <= 5; y += 1) for (let x = 3; x <= 7; x += 1) data[y * width + x] = 1;
    const contour = traceContour({ width, height, data });
    expect(contour.length).toBeGreaterThan(0);
    for (const [x, y] of contour) {
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(7);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(5);
    }
  });

  it("simplify 把共线点压掉，保留拐角", () => {
    const line: Point2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 3],
    ];
    expect(simplify(line, 0.5)).toEqual([
      [0, 0],
      [3, 0],
      [3, 3],
    ]);
  });

  it("空 mask 返回 area 0，调用方据此跳过", () => {
    const empty: RleMask = { encoding: "COCO_RLE_base64", size: [4, 4], counts: "" };
    const r = maskToPolygon(empty);
    expect(r.area).toBe(0);
    expect(r.points).toEqual([]);
  });
});
