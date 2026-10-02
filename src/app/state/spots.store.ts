import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import { ConeResult, evaluateCone } from '../analysis/cone';
import { MAX_REACH, requiredReach } from '../analysis/reach';
import { CUSTOM_KIT_ID, findKit, KITS } from '../core/kits';
import { Analysis, AnalysisService, horizonKey } from './analysis.service';
import { DEFAULT_MIN_ELEVATION, DEFAULT_SKIP_RADIUS, OVERLAY_MODES, OverlayMode, Spot, SPOT_COLORS, SpotSettings } from './spot';
import { decodeSpots, encodeSpots } from './url-state';

export const DEFAULT_SETTINGS: Omit<SpotSettings, 'lat' | 'lon'> = {
  height: 5,
  kitId: KITS[0].id,
  fov: KITS[0].fov,
  azimuth: 0,
  tilt: KITS[0].defaultTilt,
  trees: true,
  skipRadius: DEFAULT_SKIP_RADIUS,
  minElevation: DEFAULT_MIN_ELEVATION,
};

export interface SpotView {
  analysis: Analysis | null;
  cone: ConeResult | null;
  /** The horizon was computed for a different location, height or tree setting. */
  stale: boolean;
  /** Distance (m) beyond which no terrain in Norway could reach into the current aim's cone. */
  requiredRadius: number;
  /** The current aim needs terrain further away than the analysis fetched (and more is available). */
  needsMoreReach: boolean;
}

@Service()
export class SpotsStore {
  private readonly analysis = inject(AnalysisService);
  private nextId = 1;

  readonly spots = signal<Spot[]>([]);
  readonly selectedId = signal<number | null>(null);
  /** True while the next map click should drop a new spot. */
  readonly placing = signal(false);
  readonly overlayMode = signal<OverlayMode>('fan-ring');
  /** Tilted map with 3D terrain from Kartverket's elevation data. */
  readonly view3d = signal(false);
  /** High-detail 3D terrain (~1 m); downloads many more elevation tiles. */
  readonly view3dHigh = signal(false);
  /** Requested map camera move (address search, restore). */
  readonly flyTo = signal<{ lat: number; lon: number; zoom: number } | null>(null);
  readonly selected = computed(() => this.spots().find((s) => s.id === this.selectedId()) ?? null);
  readonly results = this.analysis.results;

  /** Per spot: the analysis plus the cone evaluation for its current aim, when a horizon is available. */
  readonly views = computed(() => {
    const results = this.results();
    const out = new Map<number, SpotView>();
    for (const s of this.spots()) {
      const analysis = results.get(s.id) ?? null;
      const stale = !!analysis && analysis.key !== horizonKey(s);
      const aim = { azimuth: s.azimuth, tilt: s.tilt, fov: s.fov, minElevation: s.minElevation };
      const cone = analysis?.horizon ? evaluateCone(analysis.horizon, aim) : null;
      const requiredRadius = analysis?.antennaZ !== undefined ? requiredReach(aim, analysis.antennaZ) : 0;
      const reach = analysis?.coverage?.terrainRadius ?? 0;
      const needsMoreReach = !!analysis?.coverage && reach < MAX_REACH && requiredRadius > reach;
      out.set(s.id, { analysis, cone, stale, requiredRadius, needsMoreReach });
    }
    return out;
  });

  constructor() {
    const params = new URLSearchParams(location.search);
    const restored = decodeSpots(params.get('s'));
    for (const s of restored) this.add(s, false);
    const mode = OVERLAY_MODES.find((m) => m.id === params.get('v'));
    if (mode) this.overlayMode.set(mode.id);
    const mode3d = params.get('3d');
    this.view3d.set(mode3d === '1' || mode3d === 'hq');
    this.view3dHigh.set(mode3d === 'hq');
    const sel = Number(params.get('sel'));
    const spots = this.spots();
    if (spots.length) this.selectedId.set(spots[Number.isInteger(sel) && spots[sel] ? sel : 0].id);
    for (const s of spots) void this.analysis.analyse(s.id, s);

    effect(() => {
      const spots = this.spots();
      const idx = spots.findIndex((s) => s.id === this.selectedId());
      const q = new URLSearchParams();
      if (spots.length) q.set('s', encodeSpots(spots));
      if (idx > 0) q.set('sel', String(idx));
      if (this.overlayMode() !== 'fan-ring') q.set('v', this.overlayMode());
      if (this.view3d()) q.set('3d', this.view3dHigh() ? 'hq' : '1');
      const search = q.toString();
      history.replaceState(null, '', search ? `?${search}` : location.pathname);
    });

    // Once a spot has a result, re-run automatically when height or trees change at the same location,
    // or when the dish is re-aimed low enough that mountains beyond the fetched radius could matter.
    // Moving the spot leaves the result stale until the user asks again, since that means new downloads.
    effect(() => {
      const views = this.views();
      for (const s of this.spots()) {
        const v = views.get(s.id);
        const a = v?.analysis;
        if (!a || a.status !== 'done' || a.lat !== s.lat || a.lon !== s.lon) continue;
        if (v.stale || v.needsMoreReach) untracked(() => void this.analysis.analyse(s.id, s));
      }
    });
  }

  add(settings: Partial<SpotSettings> & Pick<SpotSettings, 'lat' | 'lon'>, select = true): Spot {
    const id = this.nextId++;
    const template = this.selected() ?? DEFAULT_SETTINGS;
    const spot: Spot = {
      ...DEFAULT_SETTINGS,
      height: template.height,
      kitId: template.kitId,
      fov: template.fov,
      azimuth: template.azimuth,
      tilt: template.tilt,
      trees: template.trees,
      skipRadius: template.skipRadius,
      minElevation: template.minElevation,
      ...settings,
      id,
      name: `Spot ${id}`,
      color: SPOT_COLORS[(id - 1) % SPOT_COLORS.length],
    };
    this.spots.update((list) => [...list, spot]);
    if (select) this.selectedId.set(id);
    this.placing.set(false);
    return spot;
  }

  update(id: number, patch: Partial<SpotSettings>): void {
    this.spots.update((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        if (patch.kitId && patch.kitId !== CUSTOM_KIT_ID) {
          const kit = findKit(patch.kitId);
          if (kit) {
            next.fov = kit.fov;
            next.tilt = kit.defaultTilt;
          }
        }
        return next;
      }),
    );
  }

  remove(id: number): void {
    this.analysis.forget(id);
    this.spots.update((list) => list.filter((s) => s.id !== id));
    if (this.selectedId() === id) this.selectedId.set(this.spots()[0]?.id ?? null);
  }

  select(id: number): void {
    this.selectedId.set(id);
  }

  analyse(id: number): void {
    const s = this.spots().find((x) => x.id === id);
    if (s) void this.analysis.analyse(id, s);
  }
}
