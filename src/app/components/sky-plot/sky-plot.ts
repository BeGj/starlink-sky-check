import { afterNextRender, Component, DestroyRef, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';

/** Elevation shown at the plot's outer edge (deg); a little below the horizon so negative horizons are visible. */
const EDGE_EL = -10;
const COLORS = {
  sky: '#eaf3fb',
  terrain: '#8a9a7b',
  blocked: '#dc2626',
  cone: '#1d4ed8',
  grid: 'rgba(15, 23, 42, 0.25)',
  text: '#0f172a',
};

/**
 * Polar sky view as seen from above: zenith in the centre, north up, east right,
 * horizon (0°) on the labelled ring. Terrain is shaded; the dish cone is outlined; blocked cone area is red.
 */
@Component({
  selector: 'app-sky-plot',
  template: `<canvas #canvas role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `
    :host { display: block; aspect-ratio: 1; width: 100%; max-width: 360px; margin: 0 auto; }
    canvas { width: 100%; height: 100%; display: block; }
  `,
})
export class SkyPlot {
  readonly horizon = input.required<Float32Array>();
  readonly floor = input.required<Float32Array>();
  readonly label = input('Sky plot');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = signal(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.canvas().nativeElement;
      const ro = new ResizeObserver(([entry]) => this.size.set(entry.contentRect.width));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
    effect(() => this.draw(this.horizon(), this.floor(), this.size()));
  }

  private draw(horizon: Float32Array, floor: Float32Array, cssSize: number): void {
    if (!cssSize) return;
    const canvas = this.canvas().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(cssSize * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = cssSize / 2;
    const R = c - 18;
    const r = (el: number) => (Math.min(90, Math.max(EDGE_EL, el)) - 90) / (EDGE_EL - 90) * R;
    const xy = (az: number, el: number): [number, number] => {
      const a = (az * Math.PI) / 180;
      return [c + r(el) * Math.sin(a), c - r(el) * Math.cos(a)];
    };
    const rays = horizon.length;
    const step = 360 / rays;

    ctx.clearRect(0, 0, cssSize, cssSize);
    ctx.fillStyle = COLORS.sky;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();

    // Terrain: everything between the horizon line and the outer edge.
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    for (let i = 0; i <= rays; i++) {
      const [x, y] = xy(i * step, horizon[i % rays]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.fillStyle = COLORS.terrain;
    ctx.fill('evenodd');

    // Blocked part of the cone: between the cone floor and the horizon, ray by ray.
    ctx.fillStyle = COLORS.blocked;
    for (let i = 0; i < rays; i++) {
      const f = floor[i];
      if (Number.isNaN(f) || horizon[i] <= f) continue;
      const a0 = ((i - 0.5) * step - 90) * (Math.PI / 180);
      const a1 = ((i + 0.5) * step - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.arc(c, c, r(f), a0, a1);
      ctx.arc(c, c, r(horizon[i]), a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }

    // Grid rings and labels.
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const el of [0, 30, 60]) {
      ctx.beginPath();
      ctx.setLineDash(el === 0 ? [] : [3, 3]);
      ctx.arc(c, c, r(el), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${el}°`, c + 3, c - r(el) + 7);
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.stroke();
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const [t, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const a = (az * Math.PI) / 180;
      ctx.fillText(t, c + (R + 10) * Math.sin(a), c - (R + 10) * Math.cos(a));
    }

    // Dish cone outline.
    ctx.strokeStyle = COLORS.cone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= rays; i++) {
      const f = floor[i % rays];
      if (Number.isNaN(f)) {
        pen = false;
        continue;
      }
      const [x, y] = xy(i * step, f);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
}
