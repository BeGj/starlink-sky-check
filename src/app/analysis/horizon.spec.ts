import { computeHorizon, horizonAt } from './horizon';
import { Tile } from './tile';

function flatTile(size: number, res: number, cx: number, cy: number): Tile {
  return {
    data: new Float32Array(size * size),
    width: size,
    height: size,
    originX: cx - (size * res) / 2,
    originY: cy + (size * res) / 2,
    res,
  };
}

describe('computeHorizon', () => {
  const opts = { rays: 720, skipRadius: 0, gridConvergence: 0 };

  it('gives a negative horizon (curvature only) on flat ground', () => {
    const t = flatTile(400, 1, 0, 0);
    const h = computeHorizon([t], { x: 0, y: 0, z: 10 }, opts);
    for (const a of h.angles) expect(a).toBeLessThan(0);
  });

  it('measures a wall of height H at distance D due east as atan(H/D)', () => {
    const t = flatTile(400, 1, 0, 0);
    const H = 50;
    const D = 100;
    // Wall column at x = D (east), spanning all y.
    for (let row = 0; row < t.height; row++) {
      for (let col = 0; col < t.width; col++) {
        const x = t.originX + (col + 0.5) * t.res;
        if (x >= D) t.data[row * t.width + col] = H;
      }
    }
    const h = computeHorizon([t], { x: 0, y: 0, z: 0 }, opts);
    const expected = (Math.atan(H / D) * 180) / Math.PI;
    expect(Math.abs(horizonAt(h, 90) - expected)).toBeLessThan(0.5);
    expect(horizonAt(h, 270)).toBeLessThan(0);
    expect(Math.abs(h.distances[180] - D)).toBeLessThanOrEqual(1);
  });

  it('applies grid convergence when mapping true azimuth to the grid', () => {
    const t = flatTile(400, 1, 0, 0);
    // Single tall block 100 m along grid azimuth 10°.
    const bx = 100 * Math.sin((10 * Math.PI) / 180);
    const by = 100 * Math.cos((10 * Math.PI) / 180);
    for (let row = 0; row < t.height; row++) {
      for (let col = 0; col < t.width; col++) {
        const x = t.originX + (col + 0.5) * t.res;
        const y = t.originY - (row + 0.5) * t.res;
        if (Math.hypot(x - bx, y - by) < 3) t.data[row * t.width + col] = 100;
      }
    }
    // True north lies at grid azimuth +10° here, so the block should appear at true azimuth 0.
    const h = computeHorizon([t], { x: 0, y: 0, z: 0 }, { ...opts, gridConvergence: 10 });
    expect(horizonAt(h, 0)).toBeGreaterThan(30);
    expect(horizonAt(h, 20)).toBeLessThan(0);
  });

  it('ignores cells within the skip radius', () => {
    const t = flatTile(100, 1, 0, 0);
    for (let row = 48; row < 52; row++) for (let col = 52; col < 55; col++) t.data[row * t.width + col] = 30;
    const blocked = computeHorizon([t], { x: 0, y: 0, z: 5 }, opts);
    const skipped = computeHorizon([t], { x: 0, y: 0, z: 5 }, { ...opts, skipRadius: 8 });
    expect(horizonAt(blocked, 90)).toBeGreaterThan(45);
    expect(horizonAt(skipped, 90)).toBeLessThan(0);
  });

  it('continues into the far tile beyond the near tile', () => {
    const near = flatTile(200, 1, 0, 0);
    const far = flatTile(200, 20, 0, 0);
    for (let row = 0; row < far.height; row++) {
      for (let col = 0; col < far.width; col++) {
        const y = far.originY - (row + 0.5) * far.res;
        if (y > 1000) far.data[row * far.width + col] = 500;
      }
    }
    const h = computeHorizon([near, far], { x: 0, y: 0, z: 0 }, opts);
    expect(horizonAt(h, 0)).toBeGreaterThan(20);
    expect(h.distances[0]).toBeGreaterThan(900);
  });
});
