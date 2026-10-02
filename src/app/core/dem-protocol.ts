import { addProtocol } from 'maplibre-gl';
import { encodeTerrarium, tileBounds3857 } from './dem-tiles';
import { fetchMercatorDem, Surface } from './kartverket';

export const DEM_TILE_SIZE = 256;
const MAX_CACHED_TILES = 200;
/** Parallel requests to Kartverket's WCS; MapLibre may ask for dozens of tiles at once when tilting. */
const MAX_PARALLEL = 6;

interface Entry {
  promise: Promise<ArrayBuffer>;
  ctrl: AbortController;
  /** Pending requests for this tile; the download is cancelled only when all of them are. */
  waiters: number;
  settled: boolean;
}

/** Encoded PNG tiles by URL. The terrain and hillshade sources request the same tiles, so they share downloads. */
const cache = new Map<string, Entry>();
let active = 0;
const queue: (() => void)[] = [];
let registered = false;

/**
 * Serves `kvdem://{dom|dtm}/{z}/{x}/{y}` as Terrarium-encoded PNGs for MapLibre raster-dem sources,
 * built from Kartverket's laser elevation WCS (which can reproject to web mercator itself).
 */
export function registerDemProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('kvdem', async (params, abort) => {
    const match = /^kvdem:\/\/(dom|dtm)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if (!match) throw new Error(`Bad DEM tile URL: ${params.url}`);
    const url = params.url;
    let entry = cache.get(url);
    if (entry) {
      // Refresh recency so the LRU keeps tiles that are still in view.
      cache.delete(url);
      cache.set(url, entry);
    } else {
      const [, surface, z, x, y] = match;
      const ctrl = new AbortController();
      const created: Entry = { ctrl, waiters: 0, settled: false, promise: loadTile(surface as Surface, +z, +x, +y, ctrl.signal) };
      created.promise.then(
        () => (created.settled = true),
        () => {
          created.settled = true;
          if (cache.get(url) === created) cache.delete(url);
        },
      );
      cache.set(url, created);
      while (cache.size > MAX_CACHED_TILES) cache.delete(cache.keys().next().value!);
      entry = created;
    }
    return { data: await wait(url, entry, abort.signal) };
  });
}

function wait(url: string, entry: Entry, signal: AbortSignal): Promise<ArrayBuffer> {
  entry.waiters++;
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const onAbort = () => {
      entry.waiters--;
      if (entry.waiters === 0 && !entry.settled) {
        entry.ctrl.abort();
        if (cache.get(url) === entry) cache.delete(url);
      }
      reject(signal.reason);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        entry.waiters--;
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        entry.waiters--;
        reject(e);
      },
    );
  });
}

async function loadTile(surface: Surface, z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  await slot(signal);
  try {
    const heights = await fetchMercatorDem(surface, tileBounds3857(z, x, y), DEM_TILE_SIZE, signal);
    const pixels = new Uint8ClampedArray(DEM_TILE_SIZE * DEM_TILE_SIZE * 4);
    encodeTerrarium(heights, pixels);
    const canvas = new OffscreenCanvas(DEM_TILE_SIZE, DEM_TILE_SIZE);
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, DEM_TILE_SIZE, DEM_TILE_SIZE), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blob.arrayBuffer();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/** Waits for one of MAX_PARALLEL request slots; rejects if the tile is no longer wanted. */
function slot(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (active < MAX_PARALLEL) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', onAbort);
      active++;
      resolve();
    };
    const onAbort = () => {
      const i = queue.indexOf(start);
      if (i >= 0) queue.splice(i, 1);
      reject(signal.reason);
    };
    queue.push(start);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
