import { coneFloorAt, DishAim } from './cone';
import { CURVATURE } from './horizon';

/** Galdhøpiggen, rounded up: no terrain in Norway is higher than this. */
export const NORWAY_MAX_ELEVATION = 2470;
/** Distant-terrain radius always fetched (m). */
export const BASE_REACH = 10_000;
/** Largest radius the app will fetch (m); one extra coarse tile. */
export const MAX_REACH = 50_000;

/** Lowest elevation (deg) anywhere inside the dish's cone, or NaN if the cone never comes near the horizon. */
export function lowestConeElevation(aim: DishAim): number {
  let min = Infinity;
  for (let az = 0; az < 360; az += 1) {
    const f = coneFloorAt(aim, az);
    if (!Number.isNaN(f) && f < min) min = f;
  }
  return Number.isFinite(min) ? min : NaN;
}

/**
 * Distance (m) beyond which even the highest terrain in Norway can no longer rise into the dish's cone,
 * seen from an antenna at `antennaZ` m above sea level. Solves
 *   maxH - antennaZ - CURVATURE·d² = d·tan(lowestElevation)
 * for d, so curvature makes it finite even for cones that reach the horizon.
 */
export function requiredReach(aim: DishAim, antennaZ: number): number {
  const relief = NORWAY_MAX_ELEVATION - antennaZ;
  const lowest = lowestConeElevation(aim);
  if (relief <= 0 || Number.isNaN(lowest) || lowest >= 90) return 0;
  const t = Math.tan((lowest * Math.PI) / 180);
  return (-t + Math.sqrt(t * t + 4 * CURVATURE * relief)) / (2 * CURVATURE);
}

/** Radius to fetch for a given requirement: the base radius when enough, otherwise the maximum. */
export function reachToFetch(required: number): number {
  return required <= BASE_REACH ? BASE_REACH : MAX_REACH;
}
