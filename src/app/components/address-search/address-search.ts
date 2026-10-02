import { Component, inject, signal } from '@angular/core';
import { AddressHit, searchAddresses } from '../../core/kartverket';
import { SpotsStore } from '../../state/spots.store';

@Component({
  selector: 'app-address-search',
  template: `
    <form class="search" role="search" (submit)="$event.preventDefault(); pick(hits()[0])">
      <label for="address" class="visually-hidden">Search for an address</label>
      <input
        id="address"
        type="search"
        placeholder="Search address, e.g. Storgata 1 Oslo"
        autocomplete="off"
        aria-describedby="address-results-status"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (keydown.escape)="hits.set([])"
      />
    </form>
    <span id="address-results-status" class="visually-hidden" aria-live="polite">
      {{ hits().length ? hits().length + ' addresses found' : '' }}
    </span>
    @if (hits().length) {
      <ul id="address-results" class="results" aria-label="Address results">
        @for (h of hits(); track $index) {
          <li>
            <button type="button" (click)="pick(h)">{{ h.label }}</button>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './address-search.scss',
})
export class AddressSearch {
  private readonly store = inject(SpotsStore);
  protected readonly query = signal('');
  protected readonly hits = signal<AddressHit[]>([]);
  private timer?: ReturnType<typeof setTimeout>;
  private ctrl?: AbortController;

  protected onInput(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    if (value.trim().length < 3) {
      this.hits.set([]);
      return;
    }
    this.timer = setTimeout(async () => {
      this.ctrl?.abort();
      this.ctrl = new AbortController();
      try {
        this.hits.set(await searchAddresses(value.trim(), this.ctrl.signal));
      } catch {
        // Aborted or offline: keep the previous list.
      }
    }, 300);
  }

  protected pick(hit: AddressHit | undefined): void {
    if (!hit) return;
    this.query.set(hit.label);
    this.hits.set([]);
    this.store.flyTo.set({ lat: hit.lat, lon: hit.lon, zoom: 17 });
    // The address point is rarely exactly on the roof, so let the user click the precise spot.
    this.store.placing.set(true);
  }
}
