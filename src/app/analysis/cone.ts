import { Horizon, horizonAt } from './horizon';

const RAD = Math.PI / 180;

export interface DishAim {
  /** True azimuth the dish faces (deg). */
  azimuth: number;
  /** Tilt of the dish face from horizontal, i.e. boresight angle from zenith (deg). */
  tilt: number;
  /** Full cone angle (deg). */
  fov: number;
}

export interface ConeResult {
  /** Share of the cone's solid angle hidden by terrain, 0–1. */
  obstructedFraction: number;
  /** Lowest elevation (deg) inside the cone for each horizon ray azimuth; NaN if the cone never reaches that azimuth. */
  floor: Float32Array;
}

const SAMPLE_COUNT = 20_000;
/** Unit vectors spread uniformly over the sphere (Fibonacci lattice), as [east, north, up] triples. */
const SPHERE = fibonacciSphere(SAMPLE_COUNT);

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

export function boresight(aim: DishAim): [number, number, number] {
  const t = aim.tilt * RAD;
  const a = aim.azimuth * RAD;
  return [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), Math.cos(t)];
}

/** Lowest elevation (deg) inside the cone along a given azimuth, NaN if the cone never reaches it. */
export function coneFloorAt(aim: DishAim, azimuthDeg: number): number {
  const [be, bn, bu] = boresight(aim);
  const cosHalf = Math.cos((aim.fov / 2) * RAD);
  // Along this azimuth, dot(boresight, dir(el)) = h·cos(el) + bu·sin(el) = r·cos(el − φ).
  const h = be * Math.sin(azimuthDeg * RAD) + bn * Math.cos(azimuthDeg * RAD);
  const r = Math.hypot(h, bu);
  if (r < cosHalf) return NaN;
  const phi = Math.atan2(bu, h) / RAD;
  const delta = Math.acos(Math.min(1, cosHalf / r)) / RAD;
  const lo = Math.max(phi - delta, -90);
  return lo <= Math.min(phi + delta, 90) ? lo : NaN;
}

export function evaluateCone(horizon: Horizon, aim: DishAim): ConeResult {
  const [be, bn, bu] = boresight(aim);
  const cosHalf = Math.cos((aim.fov / 2) * RAD);
  let inside = 0;
  let blocked = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const e = SPHERE[i * 3];
    const n = SPHERE[i * 3 + 1];
    const u = SPHERE[i * 3 + 2];
    if (e * be + n * bn + u * bu < cosHalf) continue;
    inside++;
    const el = Math.asin(u) / RAD;
    const az = Math.atan2(e, n) / RAD;
    if (el < horizonAt(horizon, az)) blocked++;
  }
  const rays = horizon.angles.length;
  const floor = new Float32Array(rays);
  for (let i = 0; i < rays; i++) floor[i] = coneFloorAt(aim, (i * 360) / rays);
  return { obstructedFraction: inside ? blocked / inside : 0, floor };
}
