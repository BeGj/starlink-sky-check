import { Component, computed, inject } from '@angular/core';
import { SatellitesStore, SPEEDS } from '../satellites.store';

const MINUTE = 60_000;

@Component({
  selector: 'app-time-controls',
  template: `
    <section class="time" aria-labelledby="time-heading">
      <div class="row">
        <h2 id="time-heading">Time</h2>
        @if (store.live()) {
          <span class="live"><span class="dot" aria-hidden="true"></span>Live</span>
        } @else {
          <button type="button" class="secondary" (click)="store.goLive()">Back to now</button>
        }
      </div>
      <p class="clock">
        <time [attr.datetime]="iso()">{{ local() }}</time>
        <span class="utc">{{ utc() }} UTC</span>
      </p>
      <p class="offset">{{ offsetLabel() }}</p>

      <label for="time-slider" class="visually-hidden">Time offset from now</label>
      <input
        id="time-slider"
        type="range"
        [min]="-maxMinutes"
        [max]="maxMinutes"
        step="5"
        [value]="offsetMinutes()"
        [attr.aria-valuetext]="offsetLabel()"
        (input)="onSlide($event)"
      />
      <div class="scale" aria-hidden="true"><span>−3 days</span><span>now</span><span>+3 days</span></div>

      <div class="row controls">
        <button type="button" class="secondary" (click)="store.setPlaying(!store.playing())" [attr.aria-pressed]="!store.playing()">
          {{ store.playing() ? 'Pause' : 'Play' }}
        </button>
        <div class="speeds" role="group" aria-label="Playback speed">
          @for (s of speeds; track s) {
            <button type="button" class="secondary" [class.on]="store.speed() === s" [attr.aria-pressed]="store.speed() === s" (click)="store.setSpeed(s)">
              {{ s }}×
            </button>
          }
        </div>
      </div>
      <div class="row controls">
        <button type="button" class="secondary" (click)="jump(-60)">−1 h</button>
        <button type="button" class="secondary" (click)="jump(-10)">−10 min</button>
        <button type="button" class="secondary" (click)="jump(10)">+10 min</button>
        <button type="button" class="secondary" (click)="jump(60)">+1 h</button>
      </div>
      @if (store.approximate()) {
        <p class="note warn" role="status">
          More than a day from the latest orbit data: positions are approximate (off by tens of km, more for satellites
          that have changed orbit since).
        </p>
      }
    </section>
  `,
  styles: `
    .time { display: grid; gap: 0.4rem; }
    h2 { font-size: 0.95rem; margin: 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
    .controls { justify-content: flex-start; }
    .live { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; font-weight: 600; color: #15803d; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }
    .clock { margin: 0; font-size: 1.05rem; font-variant-numeric: tabular-nums; display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: baseline; }
    .utc { font-size: 0.8rem; color: var(--muted); }
    .offset { margin: 0; font-size: 0.8rem; color: var(--muted); }
    input[type='range'] { width: 100%; accent-color: var(--accent); }
    .scale { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--muted); margin-top: -0.3rem; }
    .speeds { display: flex; gap: 0.25rem; }
    .speeds button.on { background: #eff6ff; border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
    .note { font-size: 0.8rem; margin: 0; }
    .warn { color: #78350f; background: #fffbeb; padding: 0.4rem 0.5rem; border-radius: 6px; }
  `,
})
export class TimeControls {
  protected readonly store = inject(SatellitesStore);
  protected readonly speeds = SPEEDS;
  protected readonly maxMinutes = Math.round(this.store.maxOffsetMs / MINUTE);

  protected readonly offsetMinutes = computed(() => Math.round((this.store.simTime() - this.store.now()) / MINUTE));
  protected readonly iso = computed(() => new Date(this.store.simTime()).toISOString());
  protected readonly local = computed(() =>
    new Date(this.store.simTime()).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  protected readonly utc = computed(() => new Date(this.store.simTime()).toISOString().slice(11, 19));
  protected readonly offsetLabel = computed(() => {
    const m = this.offsetMinutes();
    if (Math.abs(m) < 1) return 'Now';
    const abs = Math.abs(m);
    const parts = abs >= 1440 ? `${Math.floor(abs / 1440)} d ${Math.floor((abs % 1440) / 60)} h` : abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
    return m < 0 ? `${parts} ago` : `${parts} ahead`;
  });

  protected onSlide(event: Event): void {
    const minutes = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(minutes)) return;
    this.store.setTime(Date.now() + minutes * MINUTE);
  }

  protected jump(minutes: number): void {
    this.store.setTime(this.store.simTime() + minutes * MINUTE);
  }
}
