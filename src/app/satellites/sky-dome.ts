const RAD = Math.PI / 180;

/** Origin of the dome in MapLibre's mercator world units, and how many units one metre is there. */
export interface DomeFrame {
  x: number;
  y: number;
  z: number;
  unitsPerMetre: number;
}

/**
 * Places each satellite on a sphere of `radiusM` around the observer, along its exact azimuth and elevation.
 * Drawing them there instead of at their true position keeps the directions exact: at Norwegian latitudes,
 * Web Mercator stretches distances by 2–3× and differently for each satellite, so true positions would appear
 * in the wrong part of the sky. Terrain closer than the radius still hides satellites behind it.
 *
 * `look` holds azimuth (deg), elevation (deg), range per satellite. Writes x, y, z per satellite to `out`,
 * or NaN for satellites lower than `minElevation`.
 */
export function domePositions(look: Float32Array, frame: DomeFrame, radiusM: number, minElevation: number, out: Float32Array): void {
  const r = radiusM * frame.unitsPerMetre;
  const n = look.length / 3;
  for (let i = 0; i < n; i++) {
    const az = look[i * 3] * RAD;
    const elDeg = look[i * 3 + 1];
    if (!(elDeg >= minElevation)) {
      out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = NaN;
      continue;
    }
    const el = elDeg * RAD;
    const horizontal = Math.cos(el) * r;
    // Mercator y grows southwards, so north is -y.
    out[i * 3] = frame.x + Math.sin(az) * horizontal;
    out[i * 3 + 1] = frame.y - Math.cos(az) * horizontal;
    out[i * 3 + 2] = frame.z + Math.sin(el) * r;
  }
}

/** A ring of constant elevation on the dome, as x, y, z triples (closed: the last point repeats the first). */
export function elevationRing(frame: DomeFrame, radiusM: number, elevationDeg: number, segments = 180): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  const look = new Float32Array((segments + 1) * 3);
  for (let k = 0; k <= segments; k++) {
    look[k * 3] = (k * 360) / segments;
    look[k * 3 + 1] = elevationDeg;
  }
  domePositions(look, frame, radiusM, -90, out);
  return out;
}
