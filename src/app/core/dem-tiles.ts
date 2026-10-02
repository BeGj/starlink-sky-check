/** Half the width of the EPSG:3857 world, in metres. */
const ORIGIN = Math.PI * 6378137;

/** Bounds of an XYZ web-mercator tile in EPSG:3857 metres: [minX, minY, maxX, maxY]. */
export function tileBounds3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * ORIGIN) / 2 ** z;
  return [-ORIGIN + x * size, ORIGIN - (y + 1) * size, -ORIGIN + (x + 1) * size, ORIGIN - y * size];
}

/**
 * Packs heights (m) into RGBA pixels using Mapzen's Terrarium encoding, which MapLibre's
 * raster-dem sources decode as h = R·256 + G + B/256 − 32768. Missing values become sea level.
 */
export function encodeTerrarium(heights: Float32Array, rgba: Uint8ClampedArray): void {
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const v = (Number.isFinite(h) ? h : 0) + 32768;
    const whole = Math.floor(v);
    const o = i * 4;
    rgba[o] = whole >> 8;
    rgba[o + 1] = whole & 255;
    rgba[o + 2] = Math.floor((v - whole) * 256);
    rgba[o + 3] = 255;
  }
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
