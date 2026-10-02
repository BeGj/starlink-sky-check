import proj4 from 'proj4';

/** EUREF89 / UTM zone 33N — the grid Kartverket serves national elevation data in. */
export const UTM33 = 'EPSG:25833';
proj4.defs(UTM33, '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

export interface Utm {
  e: number;
  n: number;
}

export function toUtm33(lon: number, lat: number): Utm {
  const [e, n] = proj4('WGS84', UTM33, [lon, lat]);
  return { e, n };
}

export function fromUtm33(e: number, n: number): [lon: number, lat: number] {
  const [lon, lat] = proj4(UTM33, 'WGS84', [e, n]);
  return [lon, lat];
}

/**
 * Azimuth of true north measured clockwise from UTM33 grid north, in degrees.
 * Positive west of the central meridian (15°E), e.g. about +8.4° at Bergen (where the
 * conventional grid convergence, grid north relative to true north, is -8.4°).
 * A true azimuth A therefore has grid azimuth A + trueNorthGridAzimuth.
 */
export function trueNorthGridAzimuth(lon: number, lat: number): number {
  const a = toUtm33(lon, lat);
  const b = toUtm33(lon, lat + 0.001);
  return (Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI;
}

/** Roughly mainland Norway + Svalbard-free bounding box, used only to warn the user. */
export function isRoughlyInNorway(lon: number, lat: number): boolean {
  return lon >= 4 && lon <= 31.5 && lat >= 57.8 && lat <= 71.5;
}
