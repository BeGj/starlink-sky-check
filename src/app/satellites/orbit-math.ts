import { degreesLat, degreesLong, ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, json2satrec, propagate, SatRec } from 'satellite.js';
import type { Omm } from './data/celestrak';

const RAD = Math.PI / 180;

export interface Observer {
  lat: number;
  lon: number;
  /** Height above sea level (m). */
  height: number;
}

export interface Positions {
  /** Per satellite: longitude (deg), latitude (deg), altitude (km). NaN when propagation failed. */
  geo: Float32Array;
  /** Per satellite, when an observer was given: azimuth (deg, from true north), elevation (deg), range (km). */
  look: Float32Array | null;
}

/** Satellite records in the same order as the elements; null where an element set couldn't be parsed. */
export function buildSatrecs(elements: readonly Omm[]): (SatRec | null)[] {
  return elements.map((e) => {
    try {
      const rec = json2satrec(e);
      return rec.error ? null : rec;
    } catch {
      return null;
    }
  });
}

/** Propagates every satellite to `date` with SGP4. */
export function propagateAll(satrecs: readonly (SatRec | null)[], date: Date, observer?: Observer): Positions {
  const n = satrecs.length;
  const geo = new Float32Array(n * 3).fill(NaN);
  const look = observer ? new Float32Array(n * 3).fill(NaN) : null;
  const gmst = gstime(date);
  const obs = observer ? { longitude: observer.lon * RAD, latitude: observer.lat * RAD, height: observer.height / 1000 } : null;
  for (let i = 0; i < n; i++) {
    const rec = satrecs[i];
    if (!rec) continue;
    const pv = propagate(rec, date, { communityDecayCheckEnabled: true });
    if (!pv) continue;
    const g = eciToGeodetic(pv.position, gmst);
    geo[i * 3] = degreesLong(g.longitude);
    geo[i * 3 + 1] = degreesLat(g.latitude);
    geo[i * 3 + 2] = g.height;
    if (look && obs) {
      const la = ecfToLookAngles(obs, eciToEcf(pv.position, gmst));
      look[i * 3] = ((la.azimuth / RAD) % 360 + 360) % 360;
      look[i * 3 + 1] = la.elevation / RAD;
      look[i * 3 + 2] = la.rangeSat;
    }
  }
  return { geo, look };
}

/** Sub-satellite points (lon, lat) from `from` to `to`, every `stepMs`; NaN entries where propagation failed. */
export function groundTrack(rec: SatRec, from: number, to: number, stepMs: number): Float32Array {
  const count = Math.max(2, Math.floor((to - from) / stepMs) + 1);
  const out = new Float32Array(count * 2).fill(NaN);
  for (let k = 0; k < count; k++) {
    const date = new Date(from + k * stepMs);
    const pv = propagate(rec, date, { communityDecayCheckEnabled: true });
    if (!pv) continue;
    const g = eciToGeodetic(pv.position, gstime(date));
    out[k * 2] = degreesLong(g.longitude);
    out[k * 2 + 1] = degreesLat(g.latitude);
  }
  return out;
}

/** Orbital period (ms) from an element set's mean motion (revolutions per day). */
export function orbitalPeriodMs(e: Pick<Omm, 'MEAN_MOTION'>): number {
  return (24 * 60 * 60 * 1000) / Number(e.MEAN_MOTION);
}

/**
 * Ground distance (m) from the observer within which a satellite at `altitudeKm` is at least `minElevation`
 * above the horizon (spherical Earth). Used to draw the observer's coverage circle.
 */
export function coverageRadius(altitudeKm: number, minElevationDeg: number): number {
  const r = 6371;
  const el = minElevationDeg * RAD;
  // Earth-central angle between observer and sub-satellite point for a given elevation.
  const central = Math.acos((r / (r + altitudeKm)) * Math.cos(el)) - el;
  return central * r * 1000;
}

/**
 * Splits a track at the antimeridian so lines don't streak across the map, returning one coordinate list
 * per continuous piece.
 */
export function splitAtAntimeridian(track: Float32Array): [number, number][][] {
  const parts: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let k = 0; k < track.length / 2; k++) {
    const lon = track[k * 2];
    const lat = track[k * 2 + 1];
    if (Number.isNaN(lon)) {
      if (current.length > 1) parts.push(current);
      current = [];
      continue;
    }
    const prev = current[current.length - 1];
    if (prev && Math.abs(lon - prev[0]) > 180) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push([lon, lat]);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}
