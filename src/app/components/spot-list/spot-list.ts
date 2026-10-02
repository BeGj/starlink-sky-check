import { Component, inject, signal } from '@angular/core';
import { SpotsStore } from '../../state/spots.store';

@Component({
  selector: 'app-spot-list',
  template: `
    <div class="head">
      <h2>Spots</h2>
      <div class="actions">
        <button type="button" class="secondary" (click)="store.placing.set(!store.placing())" [attr.aria-pressed]="store.placing()">
          {{ store.placing() ? 'Cancel' : '+ Add spot' }}
        </button>
        <button type="button" class="secondary" (click)="copyLink()" [disabled]="!store.spots().length">
          {{ copied() === 'ok' ? 'Copied!' : 'Copy link' }}
        </button>
      </div>
    </div>
    @if (copied() === 'failed') {
      <p class="hint" role="status">Couldn't access the clipboard — copy the address from the browser's address bar.</p>
    }
    @if (store.placing()) {
      <p class="hint" role="status">Click on the map where the antenna will be mounted.</p>
    }
    <ul>
      @for (s of store.spots(); track s.id) {
        @let view = store.views().get(s.id);
        <li [class.selected]="s.id === store.selectedId()">
          <button type="button" class="pick" (click)="store.select(s.id)" [attr.aria-current]="s.id === store.selectedId()">
            <span class="dot" [style.background]="s.color" aria-hidden="true"></span>
            <span class="name">{{ s.name }}</span>
            <span class="meta">{{ s.height }} m</span>
            <span class="result">
              @if (view?.analysis?.status === 'loading') {
                …
              } @else if (view?.stale || !view?.analysis) {
                –
              } @else if (view?.analysis?.status === 'error') {
                error
              } @else if (view?.cone) {
                {{ (view!.cone!.obstructedFraction * 100).toFixed(1) }}%
              }
            </span>
          </button>
          <button type="button" class="remove" (click)="store.remove(s.id)" [attr.aria-label]="'Remove ' + s.name">×</button>
        </li>
      }
    </ul>
  `,
  styleUrl: './spot-list.scss',
})
export class SpotList {
  protected readonly store = inject(SpotsStore);
  protected readonly copied = signal<'' | 'ok' | 'failed'>('');

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set('ok');
    } catch {
      this.copied.set('failed');
    }
    setTimeout(() => this.copied.set(''), 4000);
  }
}
