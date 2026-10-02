import { Component, signal } from '@angular/core';
import { AddressSearch } from './components/address-search/address-search';
import { MapView } from './components/map-view/map-view';
import { SpotList } from './components/spot-list/spot-list';
import { SpotPanel } from './components/spot-panel/spot-panel';

@Component({
  selector: 'app-root',
  imports: [AddressSearch, MapView, SpotList, SpotPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Mobile bottom sheet: collapsed shows the spot list, expanded shows everything. */
  protected readonly sheetOpen = signal(false);
}
