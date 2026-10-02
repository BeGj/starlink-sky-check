import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Component, effect, inject } from '@angular/core';
import { AddressSearch } from '../../components/address-search/address-search';
import { MapView } from '../../components/map-view/map-view';
import { SheetPanel } from '../../components/sheet-panel/sheet-panel';
import { SpotList } from '../../components/spot-list/spot-list';
import { SpotPanel } from '../../components/spot-panel/spot-panel';
import { SpotsStore } from '../../state/spots.store';

@Component({
  selector: 'app-sky-check',
  imports: [AddressSearch, MapView, SheetPanel, SpotList, SpotPanel],
  templateUrl: './sky-check.html',
  styleUrl: './sky-check.scss',
})
export class SkyCheck {
  constructor() {
    const store = inject(SpotsStore);
    const location = inject(Location);

    // The URL is the source of truth when it describes spots (a shared link); otherwise the spots the
    // store already holds (from an earlier visit to this page) are written to it. The store outlives the page,
    // so leaving and coming back keeps the spots and their downloaded horizons.
    // Read from the route: during an in-app navigation the browser URL isn't updated yet.
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const params = new URLSearchParams(query.keys.flatMap((k) => query.getAll(k).map((v) => [k, v])));
    if (params.has('s') && params.toString() !== store.query()) store.applyQuery(params);

    effect(() => {
      const query = store.query();
      location.replaceState('/sky-check', query);
    });
  }
}
