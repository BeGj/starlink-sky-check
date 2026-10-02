import { ensureCesiumCss } from '../cesium/cesium-setup';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  CesiumTerrainProvider,
  ImageryLayer,
  Ion,
  JulianDate,
  Math as CesiumMath,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
  buildModuleUrl,
  defined,
} from 'cesium';
import { BASEMAP, DEM_BOUNDS } from '../../core/map-setup';
import { ObserverSpot, SatellitesStore } from '../satellites.store';
import { SHELLS, shellOf } from '../shells';
import { CESIUM_ION_TOKEN, ionAvailable } from '../cesium/cesium-config';
import { createTerrainProvider } from '../cesium/terrain';

/** Eye height above the terrain surface (m). */
const EYE_HEIGHT = 1.7;
/** The eye is kept above the highest surface within this distance (m), like the sky check's "ignore objects closer than". */
const CLEAR_RADIUS = 10;
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
    <div class="hud" aria-hidden="true">
      <span>Looking {{ compass() }} · {{ lookElevation() }}° up · Cesium (spike{{ ionMode() === false ? ', without ion' : '' }})</span>
    </div>
    @if (!store.observer()) {
      <p class="overlay-msg">Choose an observer in the panel to look at the sky from there.</p>
    }
  `,
  styles: `
    :host { display: block; position: relative; overflow: hidden; }
    .cesium { position: absolute; inset: 0; cursor: grab; touch-action: none; }
    .cesium:active { cursor: grabbing; }
    .cesium:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
    .hud {
      position: absolute; top: 10px; left: 10px; background: rgb(255 255 255 / 0.9); color: var(--text);
      padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8rem; pointer-events: none;
    }
    .overlay-msg {
      position: absolute; top: 40%; left: 50%; transform: translateX(-50%); margin: 0; background: rgb(255 255 255 / 0.95);
      padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.85rem; max-width: min(90%, 420px); text-align: center;
    }
  `,
})
export class CesiumSky {
  protected readonly store = inject(SatellitesStore);
  /** Spike comparison: Kartverket laser terrain (trees and buildings) or Cesium World Terrain (needs the ion token). */
  readonly terrain = input<'kartverket' | 'ion'>('kartverket');
  /** Spike comparison: Bing aerial photos (needs the ion token) or Kartverket's topo map over Norway. */
  readonly imagery = input<'aerial' | 'topo'>('aerial');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private viewer?: Viewer;
  private points?: PointPrimitiveCollection;

  /** Heading (deg from north) and pitch (deg above the horizon) of the view. */
  protected readonly heading = signal(0);
  protected readonly pitch = signal(20);
  private fov = FOV.initial;
  /** Whether Cesium ion (Bing imagery, World Terrain) is in use; null until the token has been checked. */
  protected readonly ionMode = signal<boolean | null>(null);

  protected readonly compass = computed(() => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((this.heading() % 360) + 360) % 360) / 45) % 8];
  });
  protected readonly lookElevation = computed(() => Math.round(this.pitch()));
  protected readonly ariaLabel = computed(
    () => `Sky view looking ${this.compass()}, ${this.lookElevation()}° above the horizon. Drag or use the arrow keys to look around, plus and minus to zoom.`,
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    destroyRef.onDestroy(() => (destroyed = true));
    ensureCesiumCss();
    afterNextRender(async () => {
      const ion = await ionAvailable();
      if (destroyed) return;
      Ion.defaultAccessToken = ion ? CESIUM_ION_TOKEN : '';
      this.ionMode.set(ion);
      const aerial = ion && this.imagery() === 'aerial';
      const viewer = new Viewer(this.host().nativeElement, {
        // With ion: Bing aerial photos. Without: Cesium's bundled Natural Earth, with Kartverket's topo map on top.
        baseLayer: aerial
          ? ImageryLayer.fromWorldImagery({})
          : ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))),
        terrainProvider: ion && this.terrain() === 'ion' ? undefined : createTerrainProvider(),
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
      // The clock effect may have run before the viewer existed; start at the sim time.
      viewer.clock.currentTime = JulianDate.fromDate(new Date(this.store.simTime()));
      if (ion && this.terrain() === 'ion') {
        void CesiumTerrainProvider.fromIonAssetId(1).then((provider) => {
          if (!viewer.isDestroyed()) viewer.terrainProvider = provider;
        });
      }
      if (!aerial) {
        viewer.imageryLayers.addImageryProvider(
          new UrlTemplateImageryProvider({
            url: BASEMAP,
            tilingScheme: new WebMercatorTilingScheme(),
            maximumLevel: 18,
            rectangle: Rectangle.fromDegrees(...DEM_BOUNDS),
            credit: new Credit('© Kartverket'),
          }),
        );
      }
      const scene = viewer.scene;
      scene.globe.depthTestAgainstTerrain = true;
      scene.globe.enableLighting = true;
      // All camera movement is ours: drag looks around from a fixed spot.
      const ctrl = scene.screenSpaceCameraController;
      ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = ctrl.enableTilt = ctrl.enableLook = false;
      (viewer.camera.frustum as PerspectiveFrustum).fov = CesiumMath.toRadians(this.fov);

      this.points = scene.primitives.add(new PointPrimitiveCollection());
      // Finer terrain keeps arriving after the camera is placed; re-seat it once loading settles.
      scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
        if (pending === 0) this.placeCamera();
      });
      this.attachPointer(viewer);
      this.placeCamera();
      this.renderSatellites();
      destroyRef.onDestroy(() => viewer.destroy());
    });

    effect(() => {
      this.store.observer();
      untracked(() => this.placeCamera());
    });
    effect(() => this.renderSatellites());
    effect(() => {
      const t = this.store.simTime();
      if (this.viewer) this.viewer.clock.currentTime = JulianDate.fromDate(new Date(t));
    });
  }

  /** Highest loaded terrain (m) within CLEAR_RADIUS of the observer, or null before terrain loads. */
  private surfaceNear(obs: ObserverSpot): number | null {
    const globe = this.viewer?.scene.globe;
    if (!globe) return null;
    const metresPerDegLat = 111_320;
    const metresPerDegLon = metresPerDegLat * Math.cos((obs.lat * Math.PI) / 180);
    let max = -Infinity;
    for (const r of [0, 2.5, 5, 7.5, CLEAR_RADIUS]) {
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
    const shellColors = SHELLS.map((s) => Color.fromCssColorString(s.color));
    const other = Color.fromCssColorString('#64748b');
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
      } else {
        const shell = elements[i] ? shellOf(elements[i]) : -1;
        point.color = usable ? Color.WHITE : (shellColors[shell] ?? other).withAlpha(0.6);
        point.pixelSize = usable ? 7 : 4;
      }
    }
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
      if (drag?.id === e.pointerId) drag = null;
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    // Clicks select the satellite under the pointer.
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(click.position);
      const id = defined(picked) ? (picked as { id?: unknown }).id : undefined;
      this.store.select(typeof id === 'number' ? id : null);
    }, ScreenSpaceEventType.LEFT_CLICK);
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
