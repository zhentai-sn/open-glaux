import { describe, expect, it } from "vitest";

import { objectMeta } from "../test/fixtures";
import { pixelMapFor } from "./pixelMap";

describe("帧与对象像素映射", () => {
  it("预览长边缩到 4096 时保留对象原尺寸与非整数比例", () => {
    const object = objectMeta({ id: "large", modality: "natural_image" });
    object.axes = [{ name: "x", size: 8192 }, { name: "y", size: 6000 }];
    const map = pixelMapFor(object, { columns: 4096, rows: 3000 });
    expect(map.toFrame(4000, 3000)).toEqual([2000, 1500]);
    expect(map.toObject(2000, 1500)).toEqual([4000, 3000]);
    expect(map.objectDims).toEqual({ columns: 8192, rows: 6000 });
  });

  it("按实际输出宽高换算，避免 resize 四舍五入引入边界误差", () => {
    const object = objectMeta({ id: "odd", modality: "natural_image" });
    object.axes = [{ name: "x", size: 9001 }, { name: "y", size: 5001 }];
    const map = pixelMapFor(object, { columns: 4096, rows: 2276 });
    expect(map.toObject(...map.toFrame(9001, 5001))).toEqual([9001, 5001]);
  });
});
