import { decodeTerrarium, encodeTerrarium, tileBounds3857 } from './dem-tiles';

describe('dem-tiles', () => {
  it('round-trips heights through Terrarium encoding', () => {
    const heights = new Float32Array([-10, 0, 185.15, 2469, NaN]);
    const rgba = new Uint8ClampedArray(heights.length * 4);
    encodeTerrarium(heights, rgba);
    const expected = [-10, 0, 185.15, 2469, 0];
    expected.forEach((h, i) => {
      expect(Math.abs(decodeTerrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - h)).toBeLessThanOrEqual(1 / 256);
      expect(rgba[i * 4 + 3]).toBe(255);
    });
  });

  it('covers the whole world at z0', () => {
    const [minX, minY, maxX, maxY] = tileBounds3857(0, 0, 0);
    expect(minX).toBeCloseTo(-20037508.34, 1);
    expect(maxY).toBeCloseTo(20037508.34, 1);
    expect(maxX).toBeCloseTo(-minX, 6);
    expect(minY).toBeCloseTo(-maxY, 6);
  });

  it('matches the z15 Bergen tile computed in Python', () => {
    // Tile containing 60.394°N 5.34°E at z15: x 16870, y 9443.
    const b = tileBounds3857(15, 16870, 9443);
    const expected = [594374.3319455311, 8487567.620785972, 595597.3243980929, 8488790.613238534];
    b.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
  });
});
