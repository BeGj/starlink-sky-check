import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, viewChild } from '@angular/core';
import { GeoJSONSource, Map as MlMap, NavigationControl } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { initMapLibre } from '../../core/map-setup';
import { coverageRadius, splitAtAntimeridian } from '../orbit-math';
import { SatellitesStore } from '../satellites.store';
import { SHELLS, shellOf } from '../shells';

initMapLibre();

/** OpenFreeMap: free OpenStreetMap vector tiles with no key; its styles carry their own attribution. */
const WORLD_STYLE = 'https://tiles.openfreemap.org/styles/positron';
/** Typical Starlink altitude (km; most satellites orbit between about 450 and 560 km) for the observer's coverage circle. */
export const COVERAGE_ALTITUDE_KM = 500;

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

@Component({
  selector: 'app-world-map',
  template: `<div #map class="map" role="region" aria-label="World map of Starlink satellites. Select a satellite on the map to see its orbit."></div>`,
  styles: `
    :host { display: block; position: relative; }
    .map { position: absolute; inset: 0; background: #0f172a; }
  `,
})
export class WorldMap {
  private readonly store = inject(SatellitesStore);
  private readonly el = viewChild.required<ElementRef<HTMLElement>>('map');
  private map?: MlMap;
  private loaded = false;

  /** Shell index per satellite, from its inclination; only changes when new element sets arrive. */
  private readonly shells = computed(() => this.store.elements().map(shellOf));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const map = new MlMap({
        container: this.el().nativeElement,
        style: WORLD_STYLE,
        center: [12, 58],
        zoom: 1.6,
        maxPitch: 75,
        attributionControl: { compact: true },
      });
      this.map = map;
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
      map.on('style.load', () => {
        this.applyProjection();
        map.addSource('coverage', { type: 'geojson', data: empty() });
        map.addSource('track', { type: 'geojson', data: empty() });
        map.addSource('sats', { type: 'geojson', data: empty() });
        map.addSource('observer', { type: 'geojson', data: empty() });
        map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': '#15803d', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
        map.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#dc2626', 'line-width': 2 } });
        map.addLayer({
          id: 'sats',
          type: 'circle',
          source: 'sats',
          paint: {
            'circle-color': ['match', ['get', 's'], ...SHELLS.flatMap((s, i) => [i, s.color]), '#64748b'] as never,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'v'], 3, 1.6], 6, ['case', ['get', 'v'], 6, 3.5]] as never,
            'circle-stroke-color': '#0f172a',
            'circle-stroke-width': ['case', ['get', 'v'], 1.2, 0] as never,
          },
        });
        map.addLayer({
          id: 'sat-selected',
          type: 'circle',
          source: 'sats',
          filter: ['==', ['get', 'i'], -1],
          paint: { 'circle-radius': 7, 'circle-color': '#facc15', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 2 },
        });
        map.addLayer({
          id: 'observer',
          type: 'circle',
          source: 'observer',
          paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#15803d', 'circle-stroke-width': 3 },
        });
        this.loaded = true;
        this.renderSats();
        this.renderTrack();
        this.renderObserver();
        this.renderSelection();
      });
      map.on('click', 'sats', (e) => {
        const i = e.features?.[0]?.properties?.['i'];
        if (typeof i === 'number') this.store.select(i);
      });
      map.on('click', (e) => {
        if (this.store.placingObserver()) {
          this.store.placingObserver.set(false);
          void this.store.setObserver(e.lngLat.lat, e.lngLat.lng);
        }
      });
      map.on('mouseenter', 'sats', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'sats', () => (map.getCanvas().style.cursor = ''));
      destroyRef.onDestroy(() => map.remove());
    });

    effect(() => this.renderSats());
    effect(() => this.renderTrack());
    effect(() => this.renderObserver());
    effect(() => this.renderSelection());
    effect(() => {
      this.store.view();
      this.applyProjection();
    });
    effect(() => {
      const placing = this.store.placingObserver();
      if (this.map) this.map.getCanvas().style.cursor = placing ? 'crosshair' : '';
    });
  }

  private applyProjection(): void {
    if (!this.map?.isStyleLoaded()) return;
    this.map.setProjection({ type: this.store.view() === '2d' ? 'mercator' : 'globe' });
  }

  private renderSats(): void {
    const p = this.store.positions();
    const shells = this.shells();
    const minEl = this.store.minElevation();
    if (!this.loaded || !this.map || !p) return;
    const features: Feature<Point>[] = [];
    for (let i = 0; i < p.geo.length / 3; i++) {
      const lon = p.geo[i * 3];
      if (Number.isNaN(lon)) continue;
      const visible = !!p.look && p.look[i * 3 + 1] >= minEl;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, p.geo[i * 3 + 1]] }, properties: { i, s: shells[i] ?? -1, v: visible } });
    }
    (this.map.getSource('sats') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  private renderSelection(): void {
    const sel = this.store.selected();
    if (!this.loaded || !this.map) return;
    this.map.setFilter('sat-selected', ['==', ['get', 'i'], sel ?? -1]);
  }

  private renderTrack(): void {
    const t = this.store.track();
    if (!this.loaded || !this.map) return;
    const parts = t ? splitAtAntimeridian(t.track) : [];
    (this.map.getSource('track') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: parts.length ? [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: parts }, properties: {} }] : [],
    });
  }

  private renderObserver(): void {
    const obs = this.store.observer();
    const minEl = this.store.minElevation();
    if (!this.loaded || !this.map) return;
    const point: FeatureCollection = obs
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [obs.lon, obs.lat] }, properties: {} }] }
      : empty();
    (this.map.getSource('observer') as GeoJSONSource | undefined)?.setData(point);
    const circle: FeatureCollection = obs
      ? { type: 'FeatureCollection', features: [circlePolygon(obs.lon, obs.lat, coverageRadius(COVERAGE_ALTITUDE_KM, minEl))] }
      : empty();
    (this.map.getSource('coverage') as GeoJSONSource | undefined)?.setData(circle);
  }
}

/** A circle of `radiusM` around a point on a spherical Earth, as a polygon. */
function circlePolygon(lon: number, lat: number, radiusM: number, steps = 128): Feature<Polygon> {
  const RAD = Math.PI / 180;
  const d = radiusM / 6_371_000;
  const lat1 = lat * RAD;
  const lon1 = lon * RAD;
  const ring: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const brg = (k / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([lon2 / RAD, lat2 / RAD]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}
