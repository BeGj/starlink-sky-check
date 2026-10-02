import { Service, signal } from '@angular/core';
import { computeHorizon, Horizon } from '../analysis/horizon';
import { BASE_REACH, MAX_REACH, reachToFetch, requiredReach } from '../analysis/reach';
import { sampleTile, Tile } from '../analysis/tile';
import { toUtm33, trueNorthGridAzimuth } from '../core/geo';
import { fetchGroundHeight, fetchTile, Surface, TileRequest } from '../core/kartverket';
import { SpotSettings } from './spot';

/** Detailed tile: 1 m resolution, ±500 m (1000 px, ~4 MB) — trees and buildings matter here. */
const NEAR = { halfSize: 500, res: 1 };
/** Distant terrain: 20 m resolution, ±10 km (1000 px, ~4 MB) — ridges and valley sides. */
const FAR = { halfSize: BASE_REACH, res: 20 };
/** Fetched only when the dish's cone dips low enough for big mountains beyond 10 km to matter (~4 MB). */
const EXTENDED = { halfSize: MAX_REACH, res: 100 };
const RAYS = 1440;

export interface Analysis {
  status: 'loading' | 'done' | 'error';
  message: string;
  /** Settings the result was computed for; compared against the current spot to detect staleness. */
  key: string;
  lat: number;
  lon: number;
  horizon?: Horizon;
  groundZ?: number;
  antennaZ?: number;
  gridConvergence?: number;
  /** What the horizon covers, for telling the user what was accounted for. */
  coverage?: Coverage;
}

export interface Coverage {
  /** Radius (m) of the 1 m detail tile (trees and buildings when enabled). */
  detailRadius: number;
  trees: boolean;
  skipRadius: number;
  /** Radius (m) out to which terrain was checked. */
  terrainRadius: number;
  /** Resolution (m) of the coarsest terrain grid used. */
  coarsestRes: number;
  /** Distance (m) beyond which no terrain in Norway could reach into this aim's cone, at analysis time. */
  requiredRadius: number;
  /** Megabytes of elevation data used; tiles already in memory aren't downloaded again. */
  downloadedMb: number;
}

export function horizonKey(s: SpotSettings): string {
  return [s.lat.toFixed(6), s.lon.toFixed(6), s.height, s.trees, s.skipRadius].join('|');
}

@Service()
export class AnalysisService {
  private readonly tiles = new Map<string, Promise<Tile>>();
  private readonly running = new Map<number, AbortController>();
  readonly results = signal<ReadonlyMap<number, Analysis>>(new Map());

  async analyse(id: number, spot: SpotSettings): Promise<void> {
    this.running.get(id)?.abort();
    const ctrl = new AbortController();
    this.running.set(id, ctrl);
    const key = horizonKey(spot);
    const base = { key, lat: spot.lat, lon: spot.lon };
    const set = (a: Analysis) => {
      if (!ctrl.signal.aborted) this.results.update((m) => new Map(m).set(id, a));
    };

    try {
      const { e, n } = toUtm33(spot.lon, spot.lat);
      const ce = Math.round(e);
      const cn = Math.round(n);
      const surface: Surface = spot.trees ? 'dom' : 'dtm';
      let downloaded = 0;
      const progress = (label: string) => (bytes: number) => {
        set({ ...base, status: 'loading', message: `${label}… ${((downloaded + bytes) / 1e6).toFixed(1)} MB` });
      };

      set({ ...base, status: 'loading', message: 'Looking up ground height…' });
      // The ground height decides how far away terrain can matter, so it comes first.
      const pointGround = await fetchGroundHeight(e, n, ctrl.signal).catch(() => null);
      const near = await this.tile({ surface, e: ce, n: cn, ...NEAR }, progress(spot.trees ? 'Downloading trees & terrain (1/2)' : 'Downloading terrain (1/2)'), ctrl.signal);
      downloaded += near.data.byteLength;
      const far = await this.tile({ surface: 'dtm', e: ce, n: cn, ...FAR }, progress('Downloading distant terrain (2/2)'), ctrl.signal);
      downloaded += far.data.byteLength;

      // Prefer the 1 m terrain model from the point API; fall back to the coarse far tile.
      const ground = pointGround ?? sampleTile(far, e, n);
      if (!Number.isFinite(ground)) throw new Error('No elevation data at this location');
      const antennaZ = ground + spot.height;

      const required = requiredReach({ azimuth: spot.azimuth, tilt: spot.tilt, fov: spot.fov }, antennaZ);
      const tiles = [near, far];
      if (reachToFetch(required) > BASE_REACH) {
        const extended = await this.tile({ surface: 'dtm', e: ce, n: cn, ...EXTENDED }, progress('Downloading mountains up to 50 km away (3/3)'), ctrl.signal);
        downloaded += extended.data.byteLength;
        tiles.push(extended);
      }

      const gridConvergence = trueNorthGridAzimuth(spot.lon, spot.lat);
      const horizon = computeHorizon(tiles, { x: e, y: n, z: antennaZ }, { rays: RAYS, skipRadius: spot.skipRadius, gridConvergence });
      const coarsest = tiles[tiles.length - 1];
      const coverage: Coverage = {
        detailRadius: NEAR.halfSize,
        trees: spot.trees,
        skipRadius: spot.skipRadius,
        terrainRadius: coarsest === near ? NEAR.halfSize : coarsest === far ? FAR.halfSize : EXTENDED.halfSize,
        coarsestRes: coarsest.res,
        requiredRadius: required,
        downloadedMb: downloaded / 1e6,
      };
      set({ ...base, status: 'done', message: '', horizon, groundZ: ground, antennaZ, gridConvergence, coverage });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      set({ ...base, status: 'error', message: err instanceof Error ? err.message : 'Analysis failed' });
    } finally {
      if (this.running.get(id) === ctrl) this.running.delete(id);
    }
  }

  forget(id: number): void {
    this.running.get(id)?.abort();
    this.running.delete(id);
    this.results.update((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }

  private tile(req: TileRequest, onBytes: (n: number) => void, signal: AbortSignal): Promise<Tile> {
    const key = `${req.surface}|${req.e}|${req.n}|${req.halfSize}|${req.res}`;
    let p = this.tiles.get(key);
    if (!p) {
      // Not tied to one analysis' abort signal: another spot or a later rerun may reuse the download.
      p = fetchTile(req, onBytes);
      p.catch(() => this.tiles.delete(key));
      this.tiles.set(key, p);
    }
    return abortable(p, signal);
  }
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    p.then(resolve, reject);
  });
}
