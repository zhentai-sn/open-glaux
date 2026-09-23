/** 二值笔迹 → PNG data URL；两种 mask sink 均按白色非零像素解释编辑区。 */
export function maskToPng(mask: Uint8Array, columns: number, rows: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(columns, rows);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    const value = mask[i] ? 255 : 0;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
