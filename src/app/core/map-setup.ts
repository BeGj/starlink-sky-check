import { setWorkerUrl } from 'maplibre-gl';
import { DEM_TILE_SIZE, registerDemProtocol } from './dem-protocol';
import type { Surface } from './kartverket';

export type { Surface };

/** Kartverket's topographic map; covers Norway only. */
export const BASEMAP = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
export const BASEMAP_ATTRIBUTION = '© <a href="https://www.kartverket.no/">Kartverket</a>';

let initialised = false;

/** One-time MapLibre setup shared by every map in the app. */
export function initMapLibre(): void {
  if (initialised) return;
  initialised = true;
  // MapLibre 6 loads its worker as a separate module next to its own file, which the app bundle doesn't
  // contain; angular.json copies the worker (and the shared chunk it imports) to /maplibre/.
  setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
  registerDemProtocol();
}

/**
 * Terrain detail levels. MapLibre draws terrain from DEM tiles one zoom below the view, with a mesh of
 * 128 cells per 256 px tile, so each mesh cell spans 2 DEM pixels. At 60°N:
 * - standard (DEM up to z15): ~4.8 m mesh, ~2.4 m hillshade;
 * - high (DEM up to z17): ~1.2 m mesh, about the 1 m resolution of Kartverket's laser data, at up to 16× the tiles.
 */
export const DEM_MAX_ZOOM = { standard: 15, high: 17 } as const;
export type Detail = keyof typeof DEM_MAX_ZOOM;
export const VARIANTS = (['dom', 'dtm'] as const).flatMap((surface) =>
  (['standard', 'high'] as const).map((detail) => ({ surface, detail, key: demKey(surface, detail) })),
);

export function demKey(surface: Surface, detail: Detail): string {
  return detail === 'high' ? `${surface}-hq` : surface;
}

/** Bounds of Kartverket's elevation data, roughly mainland Norway. */
export const DEM_BOUNDS: [number, number, number, number] = [4, 57.8, 31.5, 71.5];

/** Elevation sources for 3D: Kartverket laser data, only within Norway and only from z8 (3D is for local views). */
export function demSource(surface: Surface, detail: Detail) {
  return {
    type: 'raster-dem' as const,
    // Same URLs for both detail levels, so tiles up to z15 are shared through the protocol's cache.
    tiles: [`kvdem://${surface}/{z}/{x}/{y}`],
    tileSize: DEM_TILE_SIZE,
    encoding: 'terrarium' as const,
    minzoom: 8,
    maxzoom: DEM_MAX_ZOOM[detail],
    bounds: DEM_BOUNDS,
    // No attribution here: the topo basemap already credits Kartverket, and repeating it duplicates the label.
  };
}

export const SKY = {
  'sky-color': '#8fbbe8',
  'horizon-color': '#e3eef8',
  'fog-color': '#e3eef8',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.85,
};
