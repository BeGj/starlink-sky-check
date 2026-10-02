import { ensureCesiumCss } from '../cesium/cesium-setup';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  Credit,
  ImageryLayer,
  Ion,
  JulianDate,
  Material,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  PolylineCollection,
  Rectangle,
  SceneTransforms,
  TileMapServiceImageryProvider,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
  buildModuleUrl,
  defined,
} from 'cesium';
import { BASEMAP, DEM_BOUNDS } from '../../core/map-setup';
import { ObserverSpot, SatellitesStore } from '../satellites.store';
import { SHELLS, shellOf } from '../shells';
import { CESIUM_ION_TOKEN } from '../cesium/cesium-config';
import { createTerrainProvider } from '../cesium/terrain';

/** Where the 3D sky view gets its terrain and imagery. */
export type SkySource = 'kartverket' | 'ion';

/** Eye height above the terrain surface (m). */
const EYE_HEIGHT = 1.7;
/** The eye is kept above the highest surface within this distance (m), like the sky check's "ignore objects closer than". */
const CLEAR_RADIUS = 10;
/** The minimum-elevation ring is drawn this far from the observer (m); terrain in front of it hides it. */
const RING_RADIUS = 30_000;
const PITCH = { min: -20, max: 88 };
const FOV = { min: 20, max: 100, initial: 70 };

@Component({
  selector: 'app-cesium-sky',
  template: `
    <div
      #host
      class="cesium"
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
    }
  `,
  styles: `
    :host { display: block; position: relative; overflow: hidden; }
    .cesium { position: absolute; inset: 0; cursor: grab; touch-action: none; }
    .cesium:active { cursor: grabbing; }
    .cesium:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
    .hud {
      position: absolute; top: 10px; left: 10px; display: grid; gap: 0.2rem; background: rgb(255 255 255 / 0.9); color: var(--text);
      padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8rem; pointer-events: none;
    }
    .legend { display: flex; align-items: center; gap: 0.3rem; color: var(--muted); }
    .sw { width: 9px; height: 9px; border-radius: 50%; display: inline-block; border: 1px solid #0f172a; }
    .sw.usable { background: #fff; }
    .sw.low { background: #94a3b8; border-color: transparent; margin-left: 0.4rem; }
    .sat-label {
      position: absolute; display: none; transform: translate(10px, -50%); pointer-events: none;
      background: #fff; color: #991b1b; font-size: 0.75rem; font-weight: 600; padding: 0.1rem 0.35rem; border-radius: 4px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    }
    .overlay-msg {
      position: absolute; top: 40%; left: 50%; transform: translateX(-50%); margin: 0; background: rgb(255 255 255 / 0.95);
      padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.85rem; max-width: min(90%, 420px); text-align: center;
    }
  `,
})
export class CesiumSky {
  protected readonly store = inject(SatellitesStore);
  /** Kartverket: laser terrain with trees and buildings plus the topo map. Cesium ion: World Terrain plus Bing aerial photos. */
  readonly source = input<SkySource>('kartverket');

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly labelEl = viewChild.required<ElementRef<HTMLElement>>('label');
  private viewer?: Viewer;
  private points?: PointPrimitiveCollection;
  private ring?: PolylineCollection;
  /** Bumped on each source change, so a slow ion request can't override a later choice. */
  private sourceVersion = 0;

  /** Heading (deg from north) and pitch (deg above the horizon) of the view. */
  protected readonly heading = signal(0);
  protected readonly pitch = signal(20);
  private fov = FOV.initial;
  private eyeHeight = NaN;

  protected readonly compass = computed(() => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((this.heading() % 360) + 360) % 360) / 45) % 8];
  });
  protected readonly lookElevation = computed(() => Math.round(this.pitch()));
  protected readonly ariaLabel = computed(() => {
    const c = this.store.counts();
    const seen = c?.usable !== null && c?.usable !== undefined ? ` ${c.usable} satellites are above ${this.store.minElevation()}°.` : '';
    return `3D sky view looking ${this.compass()}, ${this.lookElevation()}° above the horizon.${seen} Drag or use the arrow keys to look around, plus and minus to zoom, and click a satellite to select it.`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    ensureCesiumCss();
    afterNextRender(() => {
      const viewer = new Viewer(this.host().nativeElement, {
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: false,
      });
      this.viewer = viewer;
      viewer.clock.currentTime = JulianDate.fromDate(new Date(this.store.simTime()));
      const scene = viewer.scene;
      scene.globe.depthTestAgainstTerrain = true;
      scene.globe.enableLighting = true;
      // All camera movement is ours: drag looks around from a fixed spot.
      const ctrl = scene.screenSpaceCameraController;
      ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = ctrl.enableTilt = ctrl.enableLook = false;
      (viewer.camera.frustum as PerspectiveFrustum).fov = CesiumMath.toRadians(this.fov);

      this.ring = scene.primitives.add(new PolylineCollection());
      this.points = scene.primitives.add(new PointPrimitiveCollection());
      // Finer terrain keeps arriving after the camera is placed; re-seat it once loading settles.
      scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
        if (pending === 0) this.placeCamera();
      });
      scene.postRender.addEventListener(() => this.moveLabel());
      this.attachPointer(viewer);
      this.applySource(this.source());
      this.placeCamera();
      this.renderSatellites();
      destroyRef.onDestroy(() => viewer.destroy());
    });

    effect(() => {
      const source = this.source();
      untracked(() => this.applySource(source));
    });
    effect(() => {
      this.store.observer();
      untracked(() => this.placeCamera());
    });
    effect(() => this.renderSatellites());
    effect(() => {
      this.store.minElevation();
      this.store.observer();
      untracked(() => this.renderRing());
    });
    effect(() => {
      const t = this.store.simTime();
      if (this.viewer) this.viewer.clock.currentTime = JulianDate.fromDate(new Date(t));
    });
  }

  /** Swaps terrain and imagery without recreating the viewer. */
  private applySource(source: SkySource): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const version = ++this.sourceVersion;
    const layers = viewer.imageryLayers;
    layers.removeAll();
    if (source === 'ion' && CESIUM_ION_TOKEN) {
      Ion.defaultAccessToken = CESIUM_ION_TOKEN;
      layers.add(ImageryLayer.fromWorldImagery({}));
      void CesiumTerrainProvider.fromIonAssetId(1).then((provider) => {
        if (!viewer.isDestroyed() && version === this.sourceVersion) {
          viewer.terrainProvider = provider;
          this.placeCamera();
        }
      });
    } else {
      // Cesium's bundled Natural Earth worldwide, Kartverket's topo map over Norway.
      layers.add(ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))));
      layers.addImageryProvider(
        new UrlTemplateImageryProvider({
          url: BASEMAP,
          tilingScheme: new WebMercatorTilingScheme(),
          maximumLevel: 18,
          rectangle: Rectangle.fromDegrees(...DEM_BOUNDS),
          credit: new Credit('© Kartverket'),
        }),
      );
      viewer.terrainProvider = createTerrainProvider();
    }
    // The surface under the observer depends on the terrain; find it again.
    this.eyeHeight = NaN;
    this.placeCamera();
  }

  /** Highest loaded terrain (m) within CLEAR_RADIUS of the observer, or null before terrain loads. */
  private surfaceNear(obs: ObserverSpot): number | null {
    const globe = this.viewer?.scene.globe;
    if (!globe) return null;
    const metresPerDegLat = 111_320;
    const metresPerDegLon = metresPerDegLat * Math.cos((obs.lat * Math.PI) / 180);
    let max = -Infinity;
    for (const r of [0, 0.25, 0.5, 0.75, 1].map((f) => f * CLEAR_RADIUS)) {
      const steps = r === 0 ? 1 : 16;
      for (let k = 0; k < steps; k++) {
        const b = (k / steps) * 2 * Math.PI;
        const h = globe.getHeight(Cartographic.fromDegrees(obs.lon + (Math.sin(b) * r) / metresPerDegLon, obs.lat + (Math.cos(b) * r) / metresPerDegLat));
        if (h !== undefined && h > max) max = h;
      }
    }
    return Number.isFinite(max) ? max : null;
  }

  private placeCamera(): void {
    const obs = this.store.observer();
    const viewer = this.viewer;
    if (!obs || !viewer) return;
    const surface = this.surfaceNear(obs);
    const height = Math.max(obs.height, (surface ?? obs.ground ?? 0) + EYE_HEIGHT);
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(obs.lon, obs.lat, height),
      orientation: { heading: CesiumMath.toRadians(this.heading()), pitch: CesiumMath.toRadians(this.pitch()), roll: 0 },
    });
    if (Math.abs(height - this.eyeHeight) > 0.5 || Number.isNaN(this.eyeHeight)) {
      this.eyeHeight = height;
      this.renderRing();
    }
  }

  /** A ring at the minimum elevation around the observer: Starlink uses the sky above it. */
  private renderRing(): void {
    const ring = this.ring;
    const obs = this.store.observer();
    if (!ring) return;
    ring.removeAll();
    if (!obs || Number.isNaN(this.eyeHeight)) return;
    const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(obs.lon, obs.lat, this.eyeHeight));
    const el = CesiumMath.toRadians(this.store.minElevation());
    const positions: Cartesian3[] = [];
    for (let k = 0; k <= 180; k++) {
      const az = (k / 180) * 2 * Math.PI;
      const local = new Cartesian3(Math.sin(az) * Math.cos(el) * RING_RADIUS, Math.cos(az) * Math.cos(el) * RING_RADIUS, Math.sin(el) * RING_RADIUS);
      positions.push(Matrix4.multiplyByPoint(frame, local, new Cartesian3()));
    }
    ring.add({ positions, width: 2, material: Material.fromType('Color', { color: Color.fromCssColorString('#16a34a') }) });
  }

  private renderSatellites(): void {
    const p = this.store.positions();
    const sel = this.store.selected();
    const minEl = this.store.minElevation();
    const elements = this.store.elements();
    const points = this.points;
    if (!points || !p) return;
    const n = p.geo.length / 3;
    // Rebuild only when the satellite count changes; otherwise move the existing points.
    if (points.length !== n) {
      points.removeAll();
      for (let i = 0; i < n; i++) points.add({ id: i, pixelSize: 5, color: Color.WHITE });
    }
    const shellColors = SHELLS.map((s) => Color.fromCssColorString(s.color).withAlpha(0.6));
    const other = Color.fromCssColorString('#64748b').withAlpha(0.6);
    const outline = Color.fromCssColorString('#0f172a');
    for (let i = 0; i < n; i++) {
      const point = points.get(i);
      const lon = p.geo[i * 3];
      if (Number.isNaN(lon)) {
        point.show = false;
        continue;
      }
      point.show = true;
      point.position = Cartesian3.fromDegrees(lon, p.geo[i * 3 + 1], p.geo[i * 3 + 2] * 1000, undefined, point.position);
      const usable = !!p.look && p.look[i * 3 + 1] >= minEl;
      if (i === sel) {
        point.color = Color.RED;
        point.pixelSize = 11;
        point.outlineWidth = 2;
        point.outlineColor = Color.WHITE;
      } else {
        const shell = elements[i] ? shellOf(elements[i]) : -1;
        point.color = usable ? Color.WHITE : (shellColors[shell] ?? other);
        point.pixelSize = usable ? 7 : 4;
        point.outlineWidth = usable ? 1 : 0;
        point.outlineColor = outline;
      }
    }
  }

  /** Keeps the selected satellite's name next to its dot. */
  private moveLabel(): void {
    const label = this.labelEl().nativeElement;
    const sel = this.store.selected();
    const e = this.store.selectedElement();
    const viewer = this.viewer;
    const point = sel !== null && this.points && sel < this.points.length ? this.points.get(sel) : null;
    const screen = point?.show && viewer ? SceneTransforms.worldToWindowCoordinates(viewer.scene, point.position) : undefined;
    if (!e || !screen) {
      label.style.display = 'none';
      return;
    }
    label.textContent = e.OBJECT_NAME;
    label.style.display = 'block';
    label.style.left = `${screen.x}px`;
    label.style.top = `${screen.y}px`;
  }

  private look(dHeading: number, dPitch: number): void {
    if (!Number.isFinite(dHeading) || !Number.isFinite(dPitch)) return;
    this.heading.update((h) => (((h + dHeading) % 360) + 360) % 360);
    this.pitch.update((p) => Math.min(PITCH.max, Math.max(PITCH.min, p + dPitch)));
    this.placeCamera();
  }

  private zoomBy(factor: number): void {
    this.fov = Math.min(FOV.max, Math.max(FOV.min, this.fov * factor));
    if (this.viewer) (this.viewer.camera.frustum as PerspectiveFrustum).fov = CesiumMath.toRadians(this.fov);
  }

  private attachPointer(viewer: Viewer): void {
    const target = this.host().nativeElement;
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
      const height = target.clientHeight;
      if (!height) return;
      // Grab-the-sky panning: the scene follows the pointer.
      const degPerPx = this.fov / height;
      this.look(-dx * degPerPx, dy * degPerPx);
    });
    const end = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      const wasClick = !drag.moved && e.type === 'pointerup';
      drag = null;
      if (wasClick) this.pick(viewer, e);
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
  }

  /**
   * Selects the satellite under a click. Done here rather than with Cesium's ScreenSpaceEventHandler, because
   * the drag code captures the pointer and the canvas then never sees the release.
   */
  private pick(viewer: Viewer, e: PointerEvent): void {
    const rect = viewer.scene.canvas.getBoundingClientRect();
    const picked = viewer.scene.pick(new Cartesian2(e.clientX - rect.left, e.clientY - rect.top), 9, 9);
    const id = defined(picked) ? (picked as { id?: unknown }).id : undefined;
    this.store.select(typeof id === 'number' ? id : null);
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
