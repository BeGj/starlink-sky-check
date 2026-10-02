import { Credit, CustomHeightmapTerrainProvider, Rectangle, WebMercatorTilingScheme } from 'cesium';
import { decodeTerrarium, tileBounds3857 } from '../../core/dem-tiles';
import { fetchMercatorDem } from '../../core/kartverket';
import { DEM_BOUNDS } from '../../core/map-setup';

/** Height samples per tile edge; heightmap tiles share their edge samples with their neighbours. */
export const SAMPLES = 65;
/** Kartverket's laser data is ~1 m; at 60°N a level-17 tile is ~150 m wide, so 65 samples are ~2.3 m apart. */
const KARTVERKET_LEVELS = { min: 8, max: 17 };
/**
 * From this level (tiles ≲600 m across at 60°N, so only near the camera) the surface model with trees and
 * buildings is used; coarser tiles use bare terrain. Tree canopies sampled every ~10–40 m on steep slopes
 * turn mountainsides into spikes, while nearby trees and houses are what actually block a dish.
 */
const SURFACE_FROM_LEVEL = 15;
/** Global open terrain (AWS Terrain Tiles, Terrarium PNGs); ~30 m data, so finer levels add nothing. */
const TERRARIUM = { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium', maxLevel: 13 };
/** Concurrent tile downloads. Above this the callback reports "busy" and Cesium asks again later. */
const MAX_PARALLEL = 6;

const NORWAY = Rectangle.fromDegrees(...DEM_BOUNDS);
const tiling = new WebMercatorTilingScheme();

export type TerrainSource = 'kartverket' | 'terrarium';

/** Which source serves a tile: Kartverket's laser data inside Norway from level 8, open global terrain otherwise. */
export function sourceForTile(x: number, y: number, level: number): TerrainSource {
  if (level < KARTVERKET_LEVELS.min) return 'terrarium';
  const rect = tiling.tileXYToRectangle(x, y, level);
  return Rectangle.intersection(rect, NORWAY) ? 'kartverket' : 'terrarium';
}

/** Deepest level with real data for a tile; beyond it Cesium upsamples the parent instead of asking again. */
export function maxLevelFor(source: TerrainSource): number {
  return source === 'kartverket' ? KARTVERKET_LEVELS.max : TERRARIUM.maxLevel;
}

/**
 * Bounds (EPSG:3857) to request so that SAMPLES pixel centres land exactly on the tile's edges and on a
 * regular grid between them: the WCS samples pixel centres, so the box is widened by half a sample each side.
 */
export function sampleBounds(x: number, y: number, level: number): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = tileBounds3857(level, x, y);
  const half = (maxX - minX) / (SAMPLES - 1) / 2;
  return [minX - half, minY - half, maxX + half, maxY + half];
}

let active = 0;

/** Terrain for the sky view: Kartverket (trees and buildings) in Norway, AWS Terrain Tiles elsewhere. */
export function createTerrainProvider(): CustomHeightmapTerrainProvider {
  const provider = new CustomHeightmapTerrainProvider({
    width: SAMPLES,
    height: SAMPLES,
    tilingScheme: tiling,
    credit: new Credit('Elevation © Kartverket; AWS Terrain Tiles (Mapzen, USGS and others)'),
    callback: (x, y, level) => {
      if (active >= MAX_PARALLEL) return undefined;
      active++;
      const source = sourceForTile(x, y, level);
      const load = source === 'kartverket' ? kartverketHeights(x, y, level) : terrariumHeights(x, y, level);
      return load.finally(() => active--);
    },
  });
  // CustomHeightmapTerrainProvider has no availability information, so Cesium would keep refining near the
  // camera forever. Report tiles past each source's useful depth as unavailable; Cesium upsamples the parent.
  provider.getTileDataAvailable = (x, y, level) => level <= maxLevelFor(sourceForTile(x, y, level));
  return provider;
}

async function kartverketHeights(x: number, y: number, level: number): Promise<Float32Array> {
  try {
    const heights = await fetchMercatorDem(level >= SURFACE_FROM_LEVEL ? 'dom' : 'dtm', sampleBounds(x, y, level), SAMPLES);
    // Sea and areas outside Kartverket's coverage come back as no-data.
    for (let i = 0; i < heights.length; i++) if (!Number.isFinite(heights[i]) || heights[i] < -500) heights[i] = 0;
    return heights;
  } catch {
    return new Float32Array(SAMPLES * SAMPLES);
  }
}

async function terrariumHeights(x: number, y: number, level: number): Promise<Float32Array> {
  const out = new Float32Array(SAMPLES * SAMPLES);
  try {
    const res = await fetch(`${TERRARIUM.url}/${level}/${x}/${y}.png`);
    if (!res.ok) return out;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data, width } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const step = (width - 1) / (SAMPLES - 1);
    for (let row = 0; row < SAMPLES; row++) {
      for (let col = 0; col < SAMPLES; col++) {
        const o = (Math.round(row * step) * width + Math.round(col * step)) * 4;
        out[row * SAMPLES + col] = Math.max(0, decodeTerrarium(data[o], data[o + 1], data[o + 2]));
      }
    }
  } catch {
    // Leave the tile flat; a later visit asks again.
  }
  return out;
}
