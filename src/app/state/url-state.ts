import { CUSTOM_KIT_ID, findKit } from '../core/kits';
import { DEFAULT_MIN_ELEVATION, DEFAULT_SKIP_RADIUS, SpotSettings } from './spot';

/**
 * Encodes spots as `lat,lon,height,kit,azimuth,tilt,trees,skipRadius,minElevation` separated by `;`.
 * Custom kits carry their FOV: `c120`. skipRadius and minElevation are optional when decoding (older links)
 * and fall back to the current defaults.
 */
export function encodeSpots(spots: SpotSettings[]): string {
  return spots
    .map((s) =>
      [
        s.lat.toFixed(6),
        s.lon.toFixed(6),
        round(s.height),
        s.kitId === CUSTOM_KIT_ID ? `c${round(s.fov)}` : s.kitId,
        round(s.azimuth),
        round(s.tilt),
        s.trees ? 1 : 0,
        round(s.skipRadius),
        round(s.minElevation),
      ].join(','),
    )
    .join(';');
}

export function decodeSpots(value: string | null): SpotSettings[] {
  if (!value) return [];
  const out: SpotSettings[] = [];
  for (const part of value.split(';')) {
    const [lat, lon, height, kit, azimuth, tilt, trees, skip, minEl] = part.split(',');
    const nums = [lat, lon, height, azimuth, tilt].map(Number);
    if (nums.some((v) => !Number.isFinite(v)) || !kit) continue;
    const custom = kit.startsWith('c') ? Number(kit.slice(1)) : NaN;
    const known = findKit(kit);
    if (!known && !(custom > 0 && custom <= 180)) continue;
    out.push({
      lat: nums[0],
      lon: nums[1],
      height: nums[2],
      kitId: known ? known.id : CUSTOM_KIT_ID,
      fov: known ? known.fov : custom,
      azimuth: nums[3],
      tilt: nums[4],
      trees: trees !== '0',
      skipRadius: optional(skip, 0, Infinity, DEFAULT_SKIP_RADIUS),
      minElevation: optional(minEl, 0, 90, DEFAULT_MIN_ELEVATION),
    });
  }
  return out;
}

/** Parses an optional trailing field, clamped to [min, max], or returns the fallback when it's missing or invalid. */
function optional(value: string | undefined, min: number, max: number, fallback: number): number {
  const v = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
