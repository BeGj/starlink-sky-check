import { fromArrayBuffer } from 'geotiff';
import { Tile } from '../analysis/tile';

export type Surface = 'dom' | 'dtm';

const WCS: Record<Surface, { url: string; coverage: string }> = {
  dom: { url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833', coverage: 'nhm_dom_topo_25833' },
  dtm: { url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833', coverage: 'nhm_dtm_topo_25833' },
};

export interface TileRequest {
  surface: Surface;
  /** Centre in UTM33, snapped to whole metres so pixels line up with the 1 m source grid. */
  e: number;
  n: number;
  halfSize: number;
  res: number;
}

/**
 * Kartverket's ArcGIS WCS only accepts GetCoverage as version 1.0.0 with format=GeoTIFF.
 * Requests above ~4000 px per side or ~2 km at 1 m fail, so callers keep tiles at or below 1000 px.
 */
function coverageUrl(surface: Surface, crs: string, bbox: readonly number[], width: number, height: number): string {
  const { url, coverage } = WCS[surface];
  const params = new URLSearchParams({
    service: 'WCS',
    version: '1.0.0',
    request: 'GetCoverage',
    coverage,
    crs,
    bbox: bbox.join(','),
    width: String(width),
    height: String(height),
    format: 'GeoTIFF',
  });
  return `${url}?${params}`;
}

export function wcsUrl(r: TileRequest): string {
  const px = Math.round((2 * r.halfSize) / r.res);
  const bbox = [r.e - r.halfSize, r.n - r.halfSize, r.e + r.halfSize, r.n + r.halfSize];
  return coverageUrl(r.surface, 'EPSG:25833', bbox, px, px);
}

/** Fetches a coverage and decodes its single float32 band. */
async function fetchRaster(url: string, signal?: AbortSignal, onBytes?: (loaded: number) => void) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Elevation service returned HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('tiff')) throw new Error('Elevation service did not return terrain data for this area');
  const buffer = await readWithProgress(res, onBytes);
  const image = await (await fromArrayBuffer(buffer)).getImage();
  const [data] = (await image.readRasters()) as unknown as Float32Array[];
  return { image, data: Float32Array.from(data) };
}

export async function fetchTile(r: TileRequest, onBytes?: (loaded: number) => void, signal?: AbortSignal): Promise<Tile> {
  const { image, data } = await fetchRaster(wcsUrl(r), signal, onBytes);
  const [originX, originY] = image.getOrigin();
  return { data, width: image.getWidth(), height: image.getHeight(), originX, originY, res: r.res };
}

/** Heights (m) for an XYZ web-mercator tile, row-major from the north-west corner; the WCS reprojects server-side. */
export async function fetchMercatorDem(surface: Surface, bounds3857: readonly number[], size: number, signal?: AbortSignal): Promise<Float32Array> {
  const { data } = await fetchRaster(coverageUrl(surface, 'EPSG:3857', bounds3857, size, size), signal);
  return data;
}

async function readWithProgress(res: Response, onBytes?: (loaded: number) => void): Promise<ArrayBuffer> {
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

/** Ground (terrain model) height at a point, from Kartverket's point elevation API. */
export async function fetchGroundHeight(e: number, n: number, signal?: AbortSignal): Promise<number | null> {
  const params = new URLSearchParams({ nord: String(n), ost: String(e), koordsys: '25833' });
  const res = await fetch(`https://ws.geonorge.no/hoydedata/v1/punkt?${params}`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as { punkter?: { z: number | null }[] };
  return body.punkter?.[0]?.z ?? null;
}

export interface AddressHit {
  label: string;
  lat: number;
  lon: number;
}

export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressHit[]> {
  const params = new URLSearchParams({ sok: query, treffPerSide: '8', fuzzy: 'true', utkoordsys: '4258' });
  const res = await fetch(`https://ws.geonorge.no/adresser/v1/sok?${params}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    adresser?: { adressetekst: string; poststed: string | null; kommunenavn: string; representasjonspunkt: { lat: number; lon: number } }[];
  };
  return (body.adresser ?? []).map((a) => ({
    label: `${a.adressetekst}, ${a.poststed ?? a.kommunenavn}`,
    lat: a.representasjonspunkt.lat,
    lon: a.representasjonspunkt.lon,
  }));
}
