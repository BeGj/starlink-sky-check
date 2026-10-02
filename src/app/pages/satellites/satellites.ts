import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SheetPanel } from '../../components/sheet-panel/sheet-panel';
import { ObserverView } from '../../satellites/components/observer-view';
import { TimeControls } from '../../satellites/components/time-controls';
import { COVERAGE_ALTITUDE_KM, WorldMap } from '../../satellites/components/world-map';
import { SAT_VIEWS, SatellitesStore, SatView } from '../../satellites/satellites.store';
import { SHELLS, shellOf } from '../../satellites/shells';
import { SpotsStore } from '../../state/spots.store';

@Component({
  selector: 'app-satellites',
  imports: [ObserverView, SheetPanel, TimeControls, WorldMap],
  providers: [SatellitesStore],
  templateUrl: './satellites.html',
  styleUrl: './satellites.scss',
})
export class Satellites {
  protected readonly store = inject(SatellitesStore);
  private readonly spots = inject(SpotsStore);
  protected readonly views = SAT_VIEWS;
  protected readonly shells = SHELLS;
  protected readonly coverageAltitude = COVERAGE_ALTITUDE_KM;
  protected readonly locating = signal(false);
  protected readonly locateError = signal('');

  protected readonly skyCheckSpot = this.spots.selected;
  protected readonly dataAge = computed(() => {
    const at = this.store.fetchedAt();
    if (!at) return '';
    const min = Math.round((this.store.now() - at) / 60_000);
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
  });
  /** Details of the selected satellite, including where it is in the observer's sky. */
  protected readonly selectedInfo = computed(() => {
    const i = this.store.selected();
    const e = this.store.selectedElement();
    const p = this.store.positions();
    if (i === null || !e) return null;
    const shell = SHELLS[shellOf(e)];
    return {
      name: e.OBJECT_NAME,
      norad: e.NORAD_CAT_ID,
      intl: e.OBJECT_ID,
      inclination: Number(e.INCLINATION).toFixed(1),
      shell: shell?.label ?? 'Other (raising, lowering or test orbit)',
      periodMin: (1440 / Number(e.MEAN_MOTION)).toFixed(1),
      epoch: new Date(`${e.EPOCH}Z`).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      altitude: p ? p.geo[i * 3 + 2] : NaN,
      lat: p ? p.geo[i * 3 + 1] : NaN,
      lon: p ? p.geo[i * 3] : NaN,
      az: p?.look ? p.look[i * 3] : NaN,
      el: p?.look ? p.look[i * 3 + 1] : NaN,
      range: p?.look ? p.look[i * 3 + 2] : NaN,
      hasLook: !!p?.look && !Number.isNaN(p.look[i * 3 + 1]),
    };
  });

  constructor() {
    const location = inject(Location);
    // Read from the route: during an in-app navigation the browser URL isn't updated yet.
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const params = new URLSearchParams(query.keys.flatMap((k) => query.getAll(k).map((v) => [k, v])));
    const view = SAT_VIEWS.find((v) => v.id === params.get('view'));
    if (view) this.store.view.set(view.id);
    const t = Date.parse(params.get('t') ?? '');
    if (Number.isFinite(t)) {
      this.store.playing.set(false);
      this.store.setTime(t);
    }
    const obs = (params.get('obs') ?? '').split(',').map(Number);
    if (obs.length >= 2 && obs.slice(0, 2).every(Number.isFinite) && Math.abs(obs[0]) <= 90 && Math.abs(obs[1]) <= 180) {
      void this.store.setObserver(obs[0], obs[1], Number.isFinite(obs[2]) ? Math.max(0, obs[2]) : 2);
    } else {
      this.useSkyCheckSpot();
    }
    const min = Number(params.get('min'));
    if (params.has('min') && Number.isFinite(min)) this.store.minElevation.set(Math.min(45, Math.max(0, min)));

    // The selected satellite is shared by NORAD number, which can only be resolved once the data is in.
    const sel = Number(params.get('sel'));
    if (Number.isInteger(sel) && sel > 0) {
      const resolve = effect(() => {
        if (this.store.status() !== 'ready') return;
        untracked(() => this.store.selectByNorad(sel));
        resolve.destroy();
      });
    }

    effect(() => {
      const q = new URLSearchParams();
      const o = this.store.observer();
      const e = this.store.selectedElement();
      if (this.store.view() !== 'globe') q.set('view', this.store.view());
      if (o) q.set('obs', `${o.lat.toFixed(5)},${o.lon.toFixed(5)},${o.aboveGround}`);
      if (this.store.minElevation() !== 25) q.set('min', String(this.store.minElevation()));
      if (e) q.set('sel', String(e.NORAD_CAT_ID));
      // Time only goes in the link while paused; a running clock would rewrite the URL constantly.
      if (!this.store.playing()) q.set('t', new Date(Math.round(this.store.simTime() / 1000) * 1000).toISOString());
      location.replaceState('/satellites', q.toString());
    });
  }

  protected setView(view: SatView): void {
    this.store.view.set(view);
    if (view === 'observer') this.store.placingObserver.set(false);
  }

  protected useSkyCheckSpot(): void {
    const s = this.skyCheckSpot();
    if (!s) return;
    const analysis = this.spots.results().get(s.id);
    void this.store.setObserver(s.lat, s.lon, s.height, analysis?.groundZ ?? null);
    this.store.minElevation.set(s.minElevation);
  }

  protected useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      this.locateError.set('This browser cannot share its location.');
      return;
    }
    this.locating.set(true);
    this.locateError.set('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        void this.store.setObserver(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        this.locating.set(false);
        this.locateError.set('Could not get your location. Pick a spot on the map instead.');
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }

  protected setMinElevation(event: Event): void {
    const v = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) this.store.minElevation.set(Math.min(45, Math.max(0, v)));
  }

  protected latLon(lat: number, lon: number, digits = 4): string {
    return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  protected compass(az: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  }
}
