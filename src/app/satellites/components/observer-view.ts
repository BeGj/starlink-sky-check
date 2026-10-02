import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Map as MlMap, MercatorCoordinate } from 'maplibre-gl';
import { isRoughlyInNorway } from '../../core/geo';
import { BASEMAP, BASEMAP_ATTRIBUTION, demSource, initMapLibre, SKY } from '../../core/map-setup';
import { ObserverSpot, SatellitesStore } from '../satellites.store';
import { DomeFrame, domePositions, elevationRing } from '../sky-dome';
import { projectToScreen, SkyLayer } from './sky-layer';

initMapLibre();

/** Satellites are drawn this far from the observer (m): beyond nearby hills, close enough for precise depth. */
const DOME_RADIUS = 30_000;
/** Eye height above the terrain surface (m), so the camera never ends up inside the ground mesh. */
const EYE_HEIGHT = 1.7;
const PITCH = { min: 70, max: 178 };
const FOV = { min: 20, max: 100, initial: 70 };
const PICK_RADIUS_PX = 16;

const STYLE = {
  usable: [0.06, 0.09, 0.16, 1, 7],
  low: [0.28, 0.33, 0.41, 0.55, 5],
  selected: [0.86, 0.15, 0.15, 1, 12],
  ring: [0.08, 0.5, 0.24, 0.9, 0],
} as const;

@Component({
  selector: 'app-observer-view',
  template: `
    <div
      #map
      class="map"
      tabindex="0"
      role="application"
      aria-roledescription="sky view"
      [attr.aria-label]="ariaLabel()"
      (keydown)="onKeydown($event)"
    ></div>
    <div #label class="sat-label" aria-hidden="true"></div>
    <div class="hud" aria-hidden="true">
      <span>Looking {{ compass() }} · {{ lookElevation() }}° up</span>
      <span class="legend"><span class="sw usable"></span>Above {{ store.minElevation() }}° <span class="sw low"></span>Lower</span>
    </div>
    @if (!store.observer()) {
      <p class="overlay-msg">Choose an observer in the panel (or on the world map) to look at the sky from there.</p>
    } @else if (!inNorway()) {
      <p class="note">Terrain and map are only available in Norway; elsewhere the ground is shown flat.</p>
    }
  `,
  styles: `
    :host { display: block; position: relative; overflow: hidden; }
    .map { position: absolute; inset: 0; background: #e5e7eb; cursor: grab; touch-action: none; }
    .map:active { cursor: grabbing; }
    .map:focus-visible { outline-offset: -3px; }
    .hud {
      position: absolute; top: 10px; left: 10px; display: grid; gap: 0.2rem;
      background: rgb(255 255 255 / 0.9); color: var(--text); padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8rem; pointer-events: none;
    }
    .legend { display: flex; align-items: center; gap: 0.3rem; color: var(--muted); }
    .sw { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .sw.usable { background: #0f172a; }
    .sw.low { background: #94a3b8; margin-left: 0.4rem; }
    .sat-label {
      position: absolute; display: none; transform: translate(10px, -50%); pointer-events: none;
      background: #fff; color: #991b1b; font-size: 0.75rem; font-weight: 600; padding: 0.1rem 0.35rem; border-radius: 4px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    }
    .overlay-msg, .note {
      position: absolute; left: 50%; transform: translateX(-50%); margin: 0; background: rgb(255 255 255 / 0.95);
      padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.85rem; max-width: min(90%, 420px); text-align: center;
    }
    .overlay-msg { top: 40%; }
    .note { bottom: 32px; font-size: 0.78rem; }
  `,
})
export class ObserverView {
  protected readonly store = inject(SatellitesStore);
  private readonly el = viewChild.required<ElementRef<HTMLElement>>('map');
  private readonly labelEl = viewChild.required<ElementRef<HTMLElement>>('label');
  private map?: MlMap;
  private readonly layer = new SkyLayer();
  private frame: DomeFrame | null = null;
  /** Dome positions (x, y, z per satellite) from the latest positions. */
  private dome = new Float32Array(0);

  /** Camera direction: bearing (deg from north) and MapLibre pitch (90 = horizon, 180 = straight up). */
  protected readonly bearing = signal(0);
  protected readonly pitch = signal(110);
  private fov = FOV.initial;

  protected readonly compass = computed(() => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((this.bearing() % 360) + 360) % 360) / 45) % 8];
  });
  protected readonly lookElevation = computed(() => Math.round(this.pitch() - 90));
  protected readonly inNorway = computed(() => {
    const o = this.store.observer();
    return !!o && isRoughlyInNorway(o.lon, o.lat);
  });
  protected readonly ariaLabel = computed(() => {
    const c = this.store.counts();
    const seen = c?.usable !== null && c?.usable !== undefined ? ` ${c.usable} satellites are above ${this.store.minElevation()}°.` : '';
    return `Sky view looking ${this.compass()}, ${this.lookElevation()}° above the horizon.${seen} Drag or use the arrow keys to look around, plus and minus to zoom, and click a satellite to select it.`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const map = new MlMap({
        container: this.el().nativeElement,
        style: {
          version: 8,
          sources: {
            topo: { type: 'raster', tiles: [BASEMAP], tileSize: 256, maxzoom: 18, attribution: BASEMAP_ATTRIBUTION },
            terrain: demSource('dom', 'standard'),
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#e5e7eb' } },
            { id: 'topo', type: 'raster', source: 'topo' },
          ],
          sky: SKY,
        },
        center: [10.5, 63.5],
        zoom: 14,
        maxZoom: 24,
        maxPitch: 180,
        centerClampedToGround: false,
        interactive: true,
        dragPan: false,
        dragRotate: false,
        scrollZoom: false,
        boxZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        touchPitch: false,
        keyboard: false,
        attributionControl: { compact: true },
      });
      this.map = map;
      map.setVerticalFieldOfView(this.fov);
      map.on('load', () => {
        map.setTerrain({ source: 'terrain', exaggeration: 1 });
        map.addLayer(this.layer);
        this.updateFrame();
        this.applyCamera();
      });
      // Terrain arrives after the first frames; re-seat the camera so it stands on the loaded surface.
      map.on('sourcedata', (e) => {
        if (e.sourceId === 'terrain' && e.isSourceLoaded) this.applyCamera();
      });
      this.layer.onRender = () => this.moveLabel();
      this.attachPointer(map.getCanvasContainer());
      destroyRef.onDestroy(() => map.remove());
    });

    effect(() => {
      this.store.observer();
      untracked(() => {
        this.updateFrame();
        this.applyCamera();
      });
    });
    effect(() => this.renderSatellites());
  }

  /** Dome origin at the observer's eye, in mercator units. */
  private updateFrame(): void {
    const obs = this.store.observer();
    if (!obs || !this.map) {
      this.frame = null;
      return;
    }
    const alt = this.eyeAltitude(obs);
    const mc = MercatorCoordinate.fromLngLat([obs.lon, obs.lat], alt);
    this.frame = { x: mc.x, y: mc.y, z: mc.z, unitsPerMetre: mc.meterInMercatorCoordinateUnits() };
    this.renderSatellites();
  }

  private eyeAltitude(obs: ObserverSpot): number {
    const surface = this.map?.queryTerrainElevation([obs.lon, obs.lat]) ?? null;
    return Math.max(obs.height, (surface ?? obs.ground ?? 0) + EYE_HEIGHT);
  }

  private applyCamera(): void {
    const obs = this.store.observer();
    const map = this.map;
    if (!obs || !map) return;
    const alt = this.eyeAltitude(obs);
    map.jumpTo(map.calculateCameraOptionsFromCameraLngLatAltRotation([obs.lon, obs.lat], alt, this.bearing(), this.pitch()));
    const f = this.frame;
    if (f && Math.abs(f.z / f.unitsPerMetre - alt) > 0.5) this.updateFrame();
  }

  private renderSatellites(): void {
    const p = this.store.positions();
    const sel = this.store.selected();
    const minEl = this.store.minElevation();
    const frame = this.frame;
    if (!frame || !p?.look) {
      this.layer.setPoints(new Float32Array(0));
      this.layer.setLines(new Float32Array(0));
      return;
    }
    const n = p.look.length / 3;
    if (this.dome.length !== n * 3) this.dome = new Float32Array(n * 3);
    domePositions(p.look, frame, DOME_RADIUS, 0, this.dome);
    // Draw lower satellites first so usable and selected ones end up on top.
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(this.dome[i * 3]) && i !== sel) order.push(i);
    order.sort((a, b) => p.look![a * 3 + 1] - p.look![b * 3 + 1]);
    if (sel !== null && !Number.isNaN(this.dome[sel * 3])) order.push(sel);
    const points = new Float32Array(order.length * 8);
    order.forEach((i, k) => {
      const style = i === sel ? STYLE.selected : p.look![i * 3 + 1] >= minEl ? STYLE.usable : STYLE.low;
      points.set([this.dome[i * 3], this.dome[i * 3 + 1], this.dome[i * 3 + 2], ...style], k * 8);
    });
    this.layer.setPoints(points);
    const ring = elevationRing(frame, DOME_RADIUS, minEl);
    const lines = new Float32Array((ring.length / 3) * 8);
    for (let k = 0; k < ring.length / 3; k++) lines.set([ring[k * 3], ring[k * 3 + 1], ring[k * 3 + 2], ...STYLE.ring], k * 8);
    this.layer.setLines(lines);
  }

  /** Keeps the selected satellite's name next to its dot. */
  private moveLabel(): void {
    const label = this.labelEl().nativeElement;
    const sel = this.store.selected();
    const e = this.store.selectedElement();
    const m = this.layer.matrix;
    const canvas = this.map?.getCanvas();
    if (sel === null || !e || !m || !canvas || Number.isNaN(this.dome[sel * 3] ?? NaN)) {
      label.style.display = 'none';
      return;
    }
    const pt = projectToScreen(m, this.dome[sel * 3], this.dome[sel * 3 + 1], this.dome[sel * 3 + 2], canvas.clientWidth, canvas.clientHeight);
    if (!pt) {
      label.style.display = 'none';
      return;
    }
    label.textContent = e.OBJECT_NAME;
    label.style.display = 'block';
    label.style.left = `${pt[0]}px`;
    label.style.top = `${pt[1]}px`;
  }

  private look(dBearing: number, dPitch: number): void {
    this.bearing.update((b) => (((b + dBearing) % 360) + 360) % 360);
    this.pitch.update((p) => Math.min(PITCH.max, Math.max(PITCH.min, p + dPitch)));
    this.applyCamera();
  }

  private zoomBy(factor: number): void {
    this.fov = Math.min(FOV.max, Math.max(FOV.min, this.fov * factor));
    this.map?.setVerticalFieldOfView(this.fov);
    this.applyCamera();
  }

  private attachPointer(target: HTMLElement): void {
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      target.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    target.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      // Grab-the-sky panning: the scene follows the finger.
      const degPerPx = this.fov / target.clientHeight;
      this.look(-dx * degPerPx, dy * degPerPx);
    });
    const end = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const wasClick = !drag.moved && e.type === 'pointerup';
      drag = null;
      if (wasClick) this.pick(e);
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
  }

  /** Selects the satellite nearest a click, if one is close enough. */
  private pick(e: PointerEvent): void {
    const m = this.layer.matrix;
    const canvas = this.map?.getCanvas();
    if (!m || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestDist = PICK_RADIUS_PX;
    for (let i = 0; i < this.dome.length / 3; i++) {
      if (Number.isNaN(this.dome[i * 3])) continue;
      const pt = projectToScreen(m, this.dome[i * 3], this.dome[i * 3 + 1], this.dome[i * 3 + 2], canvas.clientWidth, canvas.clientHeight);
      if (!pt) continue;
      const d = Math.hypot(pt[0] - x, pt[1] - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    this.store.select(best >= 0 ? best : null);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 15 : 5;
    switch (e.key) {
      case 'ArrowLeft':
        this.look(-step, 0);
        break;
      case 'ArrowRight':
        this.look(step, 0);
        break;
      case 'ArrowUp':
        this.look(0, step);
        break;
      case 'ArrowDown':
        this.look(0, -step);
        break;
      case '+':
      case '=':
        this.zoomBy(1 / 1.2);
        break;
      case '-':
        this.zoomBy(1.2);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
