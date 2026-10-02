/** A north-up raster in UTM33 with square pixels. originX/originY is the top-left corner. */
export interface Tile {
  data: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  res: number;
}

/** Bilinear sample at grid coordinates; NaN outside the tile. */
export function sampleTile(t: Tile, x: number, y: number): number {
  const fx = (x - t.originX) / t.res - 0.5;
  const fy = (t.originY - y) / t.res - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= t.width - 1 || iy >= t.height - 1) return NaN;
  const dx = fx - ix;
  const dy = fy - iy;
  const i = iy * t.width + ix;
  const d = t.data;
  const top = d[i] * (1 - dx) + d[i + 1] * dx;
  const bottom = d[i + t.width] * (1 - dx) + d[i + t.width + 1] * dx;
  return top * (1 - dy) + bottom * dy;
}

/** Largest distance from (x, y) that stays inside the tile in every direction. */
export function innerRadius(t: Tile, x: number, y: number): number {
  const minX = t.originX + t.res;
  const maxX = t.originX + (t.width - 1) * t.res;
  const maxY = t.originY - t.res;
  const minY = t.originY - (t.height - 1) * t.res;
  return Math.max(0, Math.min(x - minX, maxX - x, y - minY, maxY - y));
}
