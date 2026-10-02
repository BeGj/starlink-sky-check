import { CUSTOM_KIT_ID, findKit } from '../core/kits';
import { DEFAULT_SKIP_RADIUS, SpotSettings } from './spot';

/**
 * Encodes spots as `lat,lon,height,kit,azimuth,tilt,trees,skipRadius` separated by `;`.
 * Custom kits carry their FOV: `c120`. skipRadius is optional when decoding (older links).
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
      ].join(','),
    )
    .join(';');
}

export function decodeSpots(value: string | null): SpotSettings[] {
  if (!value) return [];
  const out: SpotSettings[] = [];
  for (const part of value.split(';')) {
    const [lat, lon, height, kit, azimuth, tilt, trees, skip] = part.split(',');
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
      skipRadius: skip !== undefined && Number.isFinite(Number(skip)) ? Math.max(0, Number(skip)) : DEFAULT_SKIP_RADIUS,
    });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
