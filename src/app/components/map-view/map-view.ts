import { afterNextRender, Component, DestroyRef, effect, ElementRef, inject, viewChild } from '@angular/core';
import { GeoJSONSource, LngLatBounds, Map as MlMap, Marker, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { runs } from '../../analysis/runs';
import { fromUtm33, toUtm33, trueNorthGridAzimuth } from '../../core/geo';
import { SpotsStore } from '../../state/spots.store';
import { OVERLAY_MODES, OverlayMode, Spot } from '../../state/spot';

const BASEMAP = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
const COLORS = { blocked: '#dc2626', clear: '#16a34a', outside: '#94a3b8' };
const AIM_LENGTH_M = 40;
/** The direction ring keeps a constant on-screen size, so it is rebuilt as the map zooms. */
const RING_RADIUS_PX = 56;
const EARTH_CIRCUMFERENCE = 40_075_016.686;

/** Which overlay layers each mode shows. */
const MODE_LAYERS: Record<OverlayMode, readonly string[]> = {
  'fan-ring': ['fan', 'blocked', 'ring-casing', 'ring'],
  area: ['area-fill', 'area-outline', 'fan', 'blocked'],
  ring: ['ring-casing', 'ring'],
  all: ['horizon', 'fan', 'blocked', 'ring-casing', 'ring'],
};
const TOGGLED_LAYERS = ['area-fill', 'area-outline', 'horizon', 'fan', 'blocked', 'ring-casing', 'ring'];

type Props = Record<string, unknown>;

// MapLibre 6 loads its worker as a separate module next to its own file, which the app bundle doesn't
// contain; angular.json copies the worker (and the shared chunk it imports) to /maplibre/.
setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href);

@Component({
  selector: 'app-map-view',
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
})
export class MapView {
  protected readonly store = inject(SpotsStore);
  protected readonly modes = OVERLAY_MODES;
  private readonly el = viewChild.required<ElementRef<HTMLElement>>('map');
  private map?: MlMap;
  private readonly markers = new Map<number, Marker>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const map = new MlMap({
        container: this.el().nativeElement,
        style: {
          version: 8,
          sources: {
            topo: { type: 'raster', tiles: [BASEMAP], tileSize: 256, maxzoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a>' },
          },
          layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
        },
        center: [10.5, 63.5],
        zoom: 4,
        maxZoom: 19,
        attributionControl: { compact: true },
      });
      map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
      map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.on('zoom', () => this.renderRings());
      map.on('click', (e) => {
        if (this.store.placing() || this.store.spots().length === 0) this.store.add({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });
      map.on('load', () => {
        map.addSource('overlay', { type: 'geojson', data: empty() });
        map.addSource('ring', { type: 'geojson', data: empty() });
        const selectedOpacity = (on: number, off: number) => ['case', ['get', 'selected'], on, off] as never;
        map.addLayer({
          id: 'area-fill',
          type: 'fill',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'area'],
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': selectedOpacity(0.22, 0.1) },
        });
        map.addLayer({
          id: 'area-outline',
          type: 'line',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'area'],
          layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': selectedOpacity(0.9, 0.4) },
        });
        map.addLayer({
          id: 'horizon',
          type: 'line',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'horizon'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': selectedOpacity(0.6, 0.3) },
        });
        map.addLayer({
          id: 'fan',
          type: 'fill',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'fan'],
          paint: { 'fill-color': COLORS.blocked, 'fill-opacity': selectedOpacity(0.3, 0.15) },
        });
        map.addLayer({
          id: 'blocked',
          type: 'line',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'blocked'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': COLORS.blocked, 'line-width': ['case', ['get', 'selected'], 4, 2.5], 'line-opacity': selectedOpacity(1, 0.5) },
        });
        map.addLayer({
          id: 'ring-casing',
          type: 'line',
          source: 'ring',
          layout: { 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': selectedOpacity(0.9, 0.5) },
        });
        map.addLayer({
          id: 'ring',
          type: 'line',
          source: 'ring',
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'status'], 'blocked', COLORS.blocked, 'clear', COLORS.clear, COLORS.outside],
            'line-width': 7,
            'line-opacity': selectedOpacity(1, 0.5),
          },
        });
        map.addLayer({
          id: 'aim',
          type: 'line',
          source: 'overlay',
          filter: ['==', ['get', 'kind'], 'aim'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1, 1.5] },
        });
        this.applyMode();
        this.renderRings();
        this.renderOverlay();
      });
      this.map = map;
      this.syncMarkers(this.store.spots(), this.store.selectedId());
      this.fitToSpots();
      destroyRef.onDestroy(() => map.remove());
    });

    effect(() => this.syncMarkers(this.store.spots(), this.store.selectedId()));
    effect(() => {
      this.store.views();
      this.store.selectedId();
      this.renderOverlay();
      this.renderRings();
    });
    effect(() => {
      this.store.overlayMode();
      this.applyMode();
    });
    effect(() => {
      const target = this.store.flyTo();
      if (target && this.map) this.map.flyTo({ center: [target.lon, target.lat], zoom: target.zoom });
    });
    effect(() => {
      const placing = this.store.placing() || this.store.spots().length === 0;
      this.map?.getCanvas().style.setProperty('cursor', placing ? 'crosshair' : '');
    });
  }

  private fitToSpots(): void {
    const spots = this.store.spots();
    if (!this.map || !spots.length) return;
    const bounds = new LngLatBounds();
    for (const s of spots) bounds.extend([s.lon, s.lat]);
    this.map.fitBounds(bounds, { padding: 120, maxZoom: 16, duration: 0 });
  }

  private syncMarkers(spots: Spot[], selectedId: number | null): void {
    const seen = new Set<number>();
    for (const s of spots) {
      seen.add(s.id);
      let marker = this.markers.get(s.id);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'spot-marker';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.store.select(s.id);
        });
        marker = new Marker({ element: el, draggable: true }).setLngLat([s.lon, s.lat]);
        marker.on('dragend', () => {
          const p = marker!.getLngLat();
          this.store.update(s.id, { lat: p.lat, lon: p.lng });
          this.store.select(s.id);
        });
        this.markers.set(s.id, marker);
      }
      const el = marker.getElement();
      el.style.setProperty('--spot-color', s.color);
      el.classList.toggle('selected', s.id === selectedId);
      el.setAttribute('aria-label', `${s.name}${s.id === selectedId ? ' (selected)' : ''}. Drag to move.`);
      const pos = marker.getLngLat();
      if (pos.lat !== s.lat || pos.lng !== s.lon) marker.setLngLat([s.lon, s.lat]);
      if (this.map && !marker.getElement().isConnected) marker.addTo(this.map);
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
  }

  private applyMode(): void {
    const map = this.map;
    if (!map?.getLayer('ring')) return;
    const visible = new Set(MODE_LAYERS[this.store.overlayMode()]);
    for (const id of TOGGLED_LAYERS) map.setLayoutProperty(id, 'visibility', visible.has(id) ? 'visible' : 'none');
  }

  private renderOverlay(): void {
    const source = this.map?.getSource<GeoJSONSource>('overlay');
    if (!source) return;
    const views = this.store.views();
    const selectedId = this.store.selectedId();
    const features: Feature[] = [];
    for (const s of this.store.spots()) {
      const selected = s.id === selectedId;
      const { e, n } = toUtm33(s.lon, s.lat);
      const view = views.get(s.id);
      const a = view?.analysis;
      if (view && a?.horizon && a.gridConvergence !== undefined && !view.stale) {
        const { angles, distances } = a.horizon;
        const rays = angles.length;
        const step = 360 / rays;
        const at = (trueAz: number, d: number): Position => {
          const g = ((trueAz + a.gridConvergence!) * Math.PI) / 180;
          return fromUtm33(e + Math.sin(g) * d, n + Math.cos(g) * d);
        };
        const points: Position[] = [];
        for (let i = 0; i < rays; i++) points.push(at(i * step, distances[i]));
        const floor = view.cone?.floor;
        const isBlocked = (k: number) => !!floor && !Number.isNaN(floor[k]) && angles[k] > floor[k];

        // Horizon area: the star-shaped polygon through every ray's horizon point.
        features.push(feature({ type: 'Polygon', coordinates: [[...points, points[0]]] }, { kind: 'area', color: s.color, selected }));

        // Neighbouring rays often hit obstacles at very different distances (a tree, then a far ridge);
        // joining those would draw long radial spikes, so lines break wherever the distance jumps.
        const continuous = (i: number, j: number) => {
          const d0 = distances[i];
          const d1 = distances[j];
          return Math.abs(d0 - d1) <= Math.max(15, 0.15 * Math.min(d0, d1));
        };
        for (const run of runs(rays, () => true, continuous)) {
          const coords = run.map((k) => points[k]);
          if (run.length === rays) coords.push(points[run[0]]);
          features.push(lineOf(coords, { kind: 'horizon', color: s.color, selected }));
        }
        for (const run of runs(rays, isBlocked, continuous)) {
          features.push(lineOf(run.map((k) => points[k]), { kind: 'blocked', selected }));
        }

        // Fan: blocked sightlines as wedges from the antenna out to the obstacle, each ray covering its own
        // angular slice so the outer edge follows the real obstacle distance.
        for (const run of runs(rays, isBlocked, () => true)) {
          const ring: Position[] = [[s.lon, s.lat]];
          for (const k of run) {
            ring.push(at((k - 0.5) * step, distances[k]), at((k + 0.5) * step, distances[k]));
          }
          ring.push([s.lon, s.lat]);
          features.push(feature({ type: 'Polygon', coordinates: [ring] }, { kind: 'fan', selected }));
        }
      }
      const az = ((s.azimuth + trueNorthGridAzimuth(s.lon, s.lat)) * Math.PI) / 180;
      features.push(
        lineOf([[s.lon, s.lat], fromUtm33(e + Math.sin(az) * AIM_LENGTH_M, n + Math.cos(az) * AIM_LENGTH_M)], { kind: 'aim', color: s.color, selected }),
      );
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  /** Direction ring at a fixed on-screen radius, coloured per direction: blocked, clear or outside the dish's view. */
  private renderRings(): void {
    const map = this.map;
    const source = map?.getSource<GeoJSONSource>('ring');
    if (!map || !source) return;
    const views = this.store.views();
    const selectedId = this.store.selectedId();
    const zoom = map.getZoom();
    const features: Feature[] = [];
    for (const s of this.store.spots()) {
      const view = views.get(s.id);
      const a = view?.analysis;
      const floor = view?.cone?.floor;
      if (!a?.horizon || !floor || view.stale) continue;
      const angles = a.horizon.angles;
      const rays = angles.length;
      const step = 360 / rays;
      const cosLat = Math.cos((s.lat * Math.PI) / 180);
      const radius = (RING_RADIUS_PX * EARTH_CIRCUMFERENCE * cosLat) / (512 * 2 ** zoom);
      // Small enough to treat the ground as flat around the antenna; azimuths here are true azimuths.
      const at = (az: number): Position => {
        const r = (az * Math.PI) / 180;
        return [s.lon + (radius * Math.sin(r)) / (111_320 * cosLat), s.lat + (radius * Math.cos(r)) / 111_320];
      };
      const status = (k: number) => (Number.isNaN(floor[k]) ? 'outside' : angles[k] > floor[k] ? 'blocked' : 'clear');
      const selected = s.id === selectedId;
      for (const run of runs(rays, () => true, (i, j) => status(i) === status(j))) {
        const coords = run.map((k) => at((k - 0.5) * step));
        coords.push(at((run[run.length - 1] + 0.5) * step));
        features.push(lineOf(coords, { status: status(run[0]), selected }));
      }
    }
    source.setData({ type: 'FeatureCollection', features });
  }
}

function feature(geometry: Geometry, properties: Props): Feature {
  return { type: 'Feature', geometry, properties };
}

/** A line; a single point becomes a zero-length line so round caps still draw it as a dot. */
function lineOf(coordinates: Position[], properties: Props): Feature {
  return feature({ type: 'LineString', coordinates: coordinates.length > 1 ? coordinates : [coordinates[0], coordinates[0]] }, properties);
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
