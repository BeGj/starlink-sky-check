import { innerRadius, sampleTile, Tile } from './tile';

export const EARTH_RADIUS = 6_371_000;
/** Standard atmospheric refraction coefficient. */
const REFRACTION_K = 0.13;
/** Apparent drop (m) of terrain per squared metre of distance, from Earth curvature less refraction. */
export const CURVATURE = (1 - REFRACTION_K) / (2 * EARTH_RADIUS);

export interface HorizonOptions {
  /** Number of azimuth rays around the full circle. */
  rays: number;
  /** Ignore cells closer than this (m), so the building the antenna sits on doesn't block itself. */
  skipRadius: number;
  /** True-north direction expressed as a grid azimuth (degrees), see trueNorthGridAzimuth(). */
  gridConvergence: number;
}

export interface Horizon {
  /** Horizon elevation angle (deg) per ray; ray i points at true azimuth i * 360 / rays. */
  angles: Float32Array;
  /** Distance (m) to the cell that sets the horizon for each ray. */
  distances: Float32Array;
}

/**
 * Maximum elevation angle of the surrounding terrain along evenly spaced rays from the antenna.
 * `tiles` go from finest to coarsest, all centred near the antenna; each ray marches through a tile
 * until it leaves it, then continues in the next, coarser one.
 */
export function computeHorizon(tiles: Tile[], antenna: { x: number; y: number; z: number }, opts: HorizonOptions): Horizon {
  const { rays, skipRadius, gridConvergence } = opts;
  const angles = new Float32Array(rays);
  const distances = new Float32Array(rays);
  const reach = tiles.map((t) => innerRadius(t, antenna.x, antenna.y));

  for (let i = 0; i < rays; i++) {
    const az = ((i * 360) / rays + gridConvergence) * (Math.PI / 180);
    const sx = Math.sin(az);
    const sy = Math.cos(az);
    let best = -Math.PI / 2;
    let bestDist = 0;

    // Half-pixel steps so narrow peaks such as single treetops between pixel centres aren't skipped.
    const march = (tile: Tile, from: number, to: number) => {
      for (let d = from; d <= to; d += tile.res / 2) {
        const z = sampleTile(tile, antenna.x + sx * d, antenna.y + sy * d);
        if (Number.isNaN(z)) continue;
        const a = Math.atan2(z - antenna.z - d * d * CURVATURE, d);
        if (a > best) {
          best = a;
          bestDist = d;
        }
      }
    };

    let done = 0;
    tiles.forEach((tile, t) => {
      if (reach[t] <= done) return;
      march(tile, t === 0 ? Math.max(skipRadius, tile.res / 2) : done + tile.res / 2, reach[t]);
      done = reach[t];
    });

    angles[i] = (best * 180) / Math.PI;
    distances[i] = bestDist;
  }
  return { angles, distances };
}

/** Horizon angle (deg) at a true azimuth, nearest ray. */
export function horizonAt(h: Horizon, azimuthDeg: number): number {
  const n = h.angles.length;
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / (360 / n)) % n;
  return h.angles[idx];
}
