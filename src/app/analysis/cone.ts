import { EARTH_RADIUS, Horizon, horizonAt } from './horizon';

const RAD = Math.PI / 180;

export interface DishAim {
  /** True azimuth the dish faces (deg). */
  azimuth: number;
  /** Tilt of the dish face from horizontal, i.e. boresight angle from zenith (deg). */
  tilt: number;
  /** Full cone angle (deg). */
  fov: number;
  /** Lowest elevation (deg) at which Starlink connects to satellites; sky below it is not part of the usable cone. */
  minElevation: number;
}

export interface ConeResult {
  /** Share of the usable cone's solid angle hidden by terrain, 0–1; NaN when no part of the cone is above the minimum elevation. */
  obstructedFraction: number;
  /** Same share, weighted by how many satellites appear in each part of the sky (see SATELLITE_WEIGHT); NaN as above. */
  weightedObstructedFraction: number;
  /** Lowest usable elevation (deg) inside the cone for each horizon ray azimuth; NaN if the cone never reaches that azimuth. */
  floor: Float32Array;
}

const SAMPLE_COUNT = 20_000;
/** Unit vectors spread uniformly over the sphere (Fibonacci lattice), as [east, north, up] triples. */
const SPHERE = fibonacciSphere(SAMPLE_COUNT);

/** Altitude (m) of Starlink's main shells, used for the satellite-density weighting. */
const SHELL_ALTITUDE = 550_000;

/**
 * Relative number of satellites per unit of sky solid angle at a given elevation (deg), for satellites
 * spread evenly over a spherical shell: slant range² / cos(angle between the line of sight and the shell's normal).
 * Low sky looks through a much larger patch of the shell, so it holds more satellites: about 7× the zenith at 25°.
 * Real Starlink shells are not even in latitude, so this is a geometric estimate only.
 */
export function satelliteWeight(elevationDeg: number): number {
  const rs = EARTH_RADIUS + SHELL_ALTITUDE;
  const cosEl = Math.cos(elevationDeg * RAD);
  const sinEl = Math.sin(elevationDeg * RAD);
  const range = Math.sqrt(rs * rs - EARTH_RADIUS * EARTH_RADIUS * cosEl * cosEl) - EARTH_RADIUS * sinEl;
  const sinIncidence = (EARTH_RADIUS * cosEl) / rs;
  return (range / SHELL_ALTITUDE) ** 2 / Math.sqrt(1 - sinIncidence * sinIncidence);
}

/** Per SPHERE sample: elevation (deg), azimuth (deg) and satellite weight, which depend only on the sample. */
const SAMPLE_EL = new Float64Array(SAMPLE_COUNT);
const SAMPLE_AZ = new Float64Array(SAMPLE_COUNT);
const SAMPLE_WEIGHT = new Float64Array(SAMPLE_COUNT);
for (let i = 0; i < SAMPLE_COUNT; i++) {
  SAMPLE_EL[i] = Math.asin(SPHERE[i * 3 + 2]) / RAD;
  SAMPLE_AZ[i] = Math.atan2(SPHERE[i * 3], SPHERE[i * 3 + 1]) / RAD;
  SAMPLE_WEIGHT[i] = satelliteWeight(SAMPLE_EL[i]);
}

function fibonacciSphere(n: number): Float64Array {
  const out = new Float64Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const up = 1 - ((i + 0.5) * 2) / n;
    const r = Math.sqrt(1 - up * up);
    const t = golden * i;
    out[i * 3] = Math.cos(t) * r;
    out[i * 3 + 1] = Math.sin(t) * r;
    out[i * 3 + 2] = up;
  }
  return out;
}

export function boresight(aim: Pick<DishAim, 'azimuth' | 'tilt'>): [number, number, number] {
  const t = aim.tilt * RAD;
  const a = aim.azimuth * RAD;
  return [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), Math.cos(t)];
}

/** Lowest usable elevation (deg) inside the cone along a given azimuth, NaN if the cone never reaches it above the minimum. */
export function coneFloorAt(aim: DishAim, azimuthDeg: number): number {
  const [be, bn, bu] = boresight(aim);
  const cosHalf = Math.cos((aim.fov / 2) * RAD);
  // Along this azimuth, dot(boresight, dir(el)) = h·cos(el) + bu·sin(el) = r·cos(el − φ).
  const h = be * Math.sin(azimuthDeg * RAD) + bn * Math.cos(azimuthDeg * RAD);
  const r = Math.hypot(h, bu);
  if (r < cosHalf) return NaN;
  const phi = Math.atan2(bu, h) / RAD;
  const delta = Math.acos(Math.min(1, cosHalf / r)) / RAD;
  const lo = Math.max(phi - delta, aim.minElevation, -90);
  return lo <= Math.min(phi + delta, 90) ? lo : NaN;
}

export function evaluateCone(horizon: Horizon, aim: DishAim): ConeResult {
  const [be, bn, bu] = boresight(aim);
  const cosHalf = Math.cos((aim.fov / 2) * RAD);
  let inside = 0;
  let blocked = 0;
  let insideWeight = 0;
  let blockedWeight = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const el = SAMPLE_EL[i];
    if (el < aim.minElevation) continue;
    if (SPHERE[i * 3] * be + SPHERE[i * 3 + 1] * bn + SPHERE[i * 3 + 2] * bu < cosHalf) continue;
    const w = SAMPLE_WEIGHT[i];
    inside++;
    insideWeight += w;
    if (el < horizonAt(horizon, SAMPLE_AZ[i])) {
      blocked++;
      blockedWeight += w;
    }
  }
  const rays = horizon.angles.length;
  const floor = new Float32Array(rays);
  for (let i = 0; i < rays; i++) floor[i] = coneFloorAt(aim, (i * 360) / rays);
  return {
    obstructedFraction: inside ? blocked / inside : NaN,
    weightedObstructedFraction: inside ? blockedWeight / insideWeight : NaN,
    floor,
  };
}
