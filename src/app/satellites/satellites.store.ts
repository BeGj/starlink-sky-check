import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { fetchGroundHeight } from '../core/kartverket';
import { isRoughlyInNorway, toUtm33 } from '../core/geo';
import type { Omm } from './data/celestrak';
import { CelestrakSource, OrbitSource } from './data/orbit-source';
import { Observer, orbitalPeriodMs, Positions } from './orbit-math';
import type { WorkerRequest, WorkerResponse } from './orbit-messages';

export type SatView = 'globe' | '2d' | 'observer';
export const SAT_VIEWS: readonly { id: SatView; label: string }[] = [
  { id: 'globe', label: '3D globe' },
  { id: '2d', label: '2D map' },
  { id: 'observer', label: 'Sky view' },
];
export const SPEEDS = [1, 10, 60, 600] as const;

/** An observer on the ground: where the sky view stands and what the world map highlights. */
export interface ObserverSpot extends Observer {
  /** Height above ground (m), e.g. a dish on a roof. */
  aboveGround: number;
  /** Ground height (m a.s.l.), when known. */
  ground: number | null;
}

/** How often positions are recomputed while time runs (ms): smooth enough at 1×, more often when fast-forwarding. */
const PROPAGATE_INTERVAL = { normal: 500, fast: 200 };
const TICK_MS = 100;
/** The sim time counts as "live" within this distance of the real time. */
const LIVE_TOLERANCE_MS = 2000;

@Injectable()
export class SatellitesStore {
  private readonly source: OrbitSource = new CelestrakSource();
  private worker?: Worker;
  private positionsId = 0;
  private trackId = 0;
  private inFlight = false;
  /** A recompute was asked for while the worker was busy; it runs once the worker answers. */
  private pending = false;
  private lastRequest = 0;
  private lastRequestedTime = NaN;
  private loadedAt = 0;

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal('');
  readonly notice = signal('');
  readonly elements = signal<readonly Omm[]>([]);
  readonly fetchedAt = signal(0);
  readonly maxOffsetMs = this.source.maxOffsetMs;

  /** Wall-clock time, ticked so "live" and the time slider stay current. */
  readonly now = signal(Date.now());
  readonly simTime = signal(Date.now());
  readonly playing = signal(true);
  readonly speed = signal<number>(1);
  readonly live = computed(() => this.playing() && this.speed() === 1 && Math.abs(this.simTime() - this.now()) < LIVE_TOLERANCE_MS);
  /** Positions are extrapolated from the latest element sets; this far from them they're approximate. */
  readonly approximate = computed(() => Math.abs(this.simTime() - this.now()) > 24 * 60 * 60 * 1000);

  readonly positions = signal<Positions | null>(null);
  readonly positionsTime = signal(0);
  readonly view = signal<SatView>('globe');
  readonly observer = signal<ObserverSpot | null>(null);
  /** True while the next click on the world map should set the observer. */
  readonly placingObserver = signal(false);
  /** Lowest elevation (deg) at which Starlink connects; satellites above it count as usable from the observer. */
  readonly minElevation = signal(25);
  /** Index into elements of the selected satellite. */
  readonly selected = signal<number | null>(null);
  readonly track = signal<{ index: number; track: Float32Array } | null>(null);

  readonly selectedElement = computed(() => {
    const i = this.selected();
    return i === null ? null : (this.elements()[i] ?? null);
  });
  readonly counts = computed(() => {
    const p = this.positions();
    if (!p) return null;
    let total = 0;
    let aboveHorizon = 0;
    let usable = 0;
    const minEl = this.minElevation();
    for (let i = 0; i < p.geo.length / 3; i++) {
      if (Number.isNaN(p.geo[i * 3])) continue;
      total++;
      const el = p.look?.[i * 3 + 1];
      if (el === undefined) continue;
      if (el > 0) aboveHorizon++;
      if (el >= minEl) usable++;
    }
    return { total, aboveHorizon: p.look ? aboveHorizon : null, usable: p.look ? usable : null };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const timer = setInterval(() => this.tick(), TICK_MS);
    destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.worker?.terminate();
    });
    void this.load();
  }

  async load(): Promise<void> {
    this.status.set('loading');
    this.error.set('');
    try {
      const data = await this.source.elementsFor(new Date(this.simTime()));
      this.loadedAt = Date.now();
      this.notice.set(data.notice ?? '');
      this.fetchedAt.set(data.fetchedAt);
      this.elements.set(data.elements);
      this.startWorker(data.elements);
    } catch (err) {
      this.status.set('error');
      this.error.set(err instanceof Error ? err.message : 'Could not load satellite data');
    }
  }

  setPlaying(playing: boolean): void {
    this.playing.set(playing);
    this.requestNow();
  }

  setSpeed(speed: number): void {
    this.speed.set(speed);
    this.playing.set(true);
  }

  goLive(): void {
    this.now.set(Date.now());
    this.simTime.set(Date.now());
    this.speed.set(1);
    this.playing.set(true);
    this.requestNow();
  }

  /** Jumps to a time, clamped to the range the orbit data supports. */
  setTime(time: number): void {
    const now = Date.now();
    this.simTime.set(Math.min(now + this.maxOffsetMs, Math.max(now - this.maxOffsetMs, time)));
    this.requestNow();
  }

  select(index: number | null): void {
    this.selected.set(index);
    this.track.set(null);
    if (index !== null) this.requestTrack(index);
  }

  selectByNorad(norad: number): void {
    const i = this.elements().findIndex((e) => Number(e.NORAD_CAT_ID) === norad);
    if (i >= 0) this.select(i);
  }

  /** Sets the observer; the ground height is looked up from Kartverket in Norway (sea level elsewhere). */
  async setObserver(lat: number, lon: number, aboveGround = 2, ground: number | null = null): Promise<void> {
    const spot: ObserverSpot = { lat, lon, aboveGround, ground, height: (ground ?? 0) + aboveGround };
    this.observer.set(spot);
    this.requestNow();
    if (ground !== null || !isRoughlyInNorway(lon, lat)) return;
    const { e, n } = toUtm33(lon, lat);
    const z = await fetchGroundHeight(e, n).catch(() => null);
    // Ignore the answer if the observer moved while it was on its way.
    if (z === null || this.observer() !== spot) return;
    this.observer.set({ ...spot, ground: z, height: z + aboveGround });
    this.requestNow();
  }

  clearObserver(): void {
    this.observer.set(null);
    if (this.view() === 'observer') this.view.set('globe');
    this.requestNow();
  }

  private startWorker(elements: readonly Omm[]): void {
    this.worker?.terminate();
    const worker = new Worker(new URL('./orbit.worker', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.inFlight = false;
    this.pending = false;
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => this.onMessage(data);
    worker.onerror = () => {
      this.status.set('error');
      this.error.set('Satellite calculations failed to start in this browser.');
    };
    this.post({ type: 'init', elements: [...elements] });
  }

  private onMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'ready': {
        this.status.set('ready');
        this.requestNow();
        const sel = this.selected();
        if (sel !== null) this.requestTrack(sel);
        break;
      }
      case 'positions':
        this.inFlight = false;
        if (msg.id === this.positionsId) {
          this.positions.set({ geo: msg.geo, look: msg.look });
          this.positionsTime.set(msg.time);
        }
        if (this.pending) this.requestPositions();
        break;
      case 'track':
        if (msg.id === this.trackId && msg.index === this.selected()) this.track.set({ index: msg.index, track: msg.track });
        break;
    }
  }

  private tick(): void {
    const now = Date.now();
    const dt = now - this.now();
    this.now.set(now);
    if (this.playing()) {
      const next = this.simTime() + dt * this.speed();
      const limit = now + this.maxOffsetMs;
      if (next >= limit) {
        this.simTime.set(limit);
        this.playing.set(false);
      } else {
        this.simTime.set(next);
      }
    }
    // Element sets are refreshed when CelesTrak would have new ones, while the page stays open.
    if (this.status() === 'ready' && now - this.loadedAt > 2 * 60 * 60 * 1000) {
      this.loadedAt = now;
      void this.load();
    }
    const interval = this.speed() > 1 ? PROPAGATE_INTERVAL.fast : PROPAGATE_INTERVAL.normal;
    if (this.playing() && now - this.lastRequest >= interval) this.requestPositions();
  }

  /** Recomputes positions as soon as the worker is free (after a jump, an observer change, …). */
  private requestNow(): void {
    this.lastRequestedTime = NaN;
    this.requestPositions();
  }

  private requestPositions(): void {
    if (this.status() !== 'ready') return;
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.pending = false;
    const time = this.simTime();
    if (time === this.lastRequestedTime) return;
    const obs = this.observer();
    this.inFlight = true;
    this.lastRequest = Date.now();
    this.lastRequestedTime = time;
    this.post({ type: 'propagate', id: ++this.positionsId, time, observer: obs ? { lat: obs.lat, lon: obs.lon, height: obs.height } : null });
  }

  private requestTrack(index: number): void {
    const e = this.elements()[index];
    if (!e || this.status() !== 'ready') return;
    const half = orbitalPeriodMs(e) / 2;
    const t = this.simTime();
    this.post({ type: 'track', id: ++this.trackId, index, from: t - half, to: t + half, stepMs: 30_000 });
  }

  private post(msg: WorkerRequest): void {
    this.worker?.postMessage(msg);
  }
}
