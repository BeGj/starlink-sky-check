import { Component, computed, inject } from '@angular/core';
import { CUSTOM_KIT_ID, findKit, KITS } from '../../core/kits';
import { isRoughlyInNorway } from '../../core/geo';
import { SpotsStore } from '../../state/spots.store';
import { SpotSettings } from '../../state/spot';
import { SkyPlot } from '../sky-plot/sky-plot';

@Component({
  selector: 'app-spot-panel',
  imports: [SkyPlot],
  templateUrl: './spot-panel.html',
  styleUrl: './spot-panel.scss',
})
export class SpotPanel {
  protected readonly store = inject(SpotsStore);
  protected readonly kits = KITS;
  protected readonly customKitId = CUSTOM_KIT_ID;

  protected readonly spot = this.store.selected;
  protected readonly view = computed(() => {
    const s = this.spot();
    return s ? (this.store.views().get(s.id) ?? null) : null;
  });
  protected readonly kit = computed(() => findKit(this.spot()?.kitId ?? ''));
  protected readonly outsideNorway = computed(() => {
    const s = this.spot();
    return !!s && !isRoughlyInNorway(s.lon, s.lat);
  });
  protected readonly percent = computed(() => {
    const cone = this.view()?.cone;
    return cone && !Number.isNaN(cone.obstructedFraction) ? cone.obstructedFraction * 100 : null;
  });
  protected readonly weightedPercent = computed(() => {
    const cone = this.view()?.cone;
    return cone && !Number.isNaN(cone.weightedObstructedFraction) ? cone.weightedObstructedFraction * 100 : null;
  });
  /** Rough, unofficial rating from the weighted figure, using thresholds commonly reported by Starlink users. */
  protected readonly rating = computed(() => {
    const p = this.weightedPercent();
    if (p === null) return null;
    if (p < 0.05) return { level: 'good', label: 'No obstructions', detail: 'Should work without interruptions.' };
    if (p <= 5) return { level: 'good', label: 'Good', detail: 'Most use works fine; expect occasional short dropouts.' };
    if (p <= 10) return { level: 'fair', label: 'Some problems likely', detail: 'Expect buffering and dropped video calls now and then.' };
    return { level: 'poor', label: 'Serious problems likely', detail: 'Frequent dropouts; browsing and video calls will suffer.' };
  });

  protected set(patch: Partial<SpotSettings>): void {
    const s = this.spot();
    if (s) this.store.update(s.id, patch);
  }

  protected num(event: Event, min: number, max: number): number | null {
    const v = (event.target as HTMLInputElement).valueAsNumber;
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }

  protected setNum(key: 'height' | 'azimuth' | 'tilt' | 'fov' | 'skipRadius' | 'minElevation', event: Event, min: number, max: number): void {
    const v = this.num(event, min, max);
    if (v !== null) this.set({ [key]: v });
  }

  protected rename(event: Event): void {
    const s = this.spot();
    const name = (event.target as HTMLInputElement).value.trim();
    if (s && name) this.store.spots.update((list) => list.map((x) => (x.id === s.id ? { ...x, name } : x)));
  }

  protected km(m: number): string {
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
  }

  protected max(a: number, b: number): number {
    return Math.max(a, b);
  }

  protected compass(az: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  }
}
