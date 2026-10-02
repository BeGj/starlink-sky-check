import { Component, ElementRef, inject, input, signal } from '@angular/core';

/** Pointer movement (px) before a press on the handle counts as a drag instead of a tap. */
const DRAG_THRESHOLD = 4;
/** Smallest sheet height (px) when dragged; keeps the handle reachable. */
const MIN_SHEET_HEIGHT = 56;
/** Largest sheet height as a fraction of the area the sheet sits in. */
const MAX_SHEET_FRACTION = 0.9;

/**
 * Side panel on wide screens; on phones a bottom sheet over the map that can be dragged to any height,
 * tapped to toggle between collapsed and expanded, or resized with the arrow keys.
 * Place it as the second column of a `position: relative` grid next to the map.
 */
@Component({
  selector: 'app-sheet-panel',
  host: {
    role: 'complementary',
    '[attr.aria-label]': 'label()',
    '[class.open]': 'open()',
    '[class.sized]': 'height() !== null',
    '[class.dragging]': 'dragging()',
    '[style.--sheet-height.px]': 'height()',
  },
  template: `
    <button
      type="button"
      class="handle"
      (click)="toggle()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (keydown)="onKeydown($event)"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="bodyId"
    >
      <span class="grip" aria-hidden="true"></span>
      <span class="visually-hidden">
        {{ open() ? 'Collapse panel' : 'Expand panel' }}. Drag, or use the up and down arrow keys, to resize.
      </span>
    </button>
    <div [id]="bodyId" class="panel-body">
      <ng-content />
    </div>
  `,
  styleUrl: './sheet-panel.scss',
})
export class SheetPanel {
  readonly label = input.required<string>();

  private static nextId = 1;
  protected readonly bodyId = `sheet-body-${SheetPanel.nextId++}`;
  /** Collapsed shows the top of the panel, expanded shows most of it. */
  protected readonly open = signal(false);
  /** Height (px) the user dragged the sheet to; null uses the collapsed/expanded preset. */
  protected readonly height = signal<number | null>(null);
  protected readonly dragging = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { pointerId: number; startY: number; startHeight: number; moved: boolean } | null = null;
  private suppressClick = false;

  protected toggle(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.height.set(null);
    this.open.update((open) => !open);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: this.host.nativeElement.getBoundingClientRect().height,
      moved: false,
    };
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dy = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    this.dragging.set(true);
    this.setHeight(drag.startHeight + dy);
  }

  protected onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.dragging.set(false);
    // A drag is followed by a click on the button; don't let it toggle the sheet.
    this.suppressClick = drag.moved && event.type === 'pointerup';
  }

  protected onKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = this.host.nativeElement.getBoundingClientRect().height;
    this.setHeight(current + step * this.maxHeight() * 0.1);
  }

  private setHeight(height: number): void {
    const max = this.maxHeight();
    const clamped = Math.min(Math.max(height, MIN_SHEET_HEIGHT), max);
    this.height.set(clamped);
    this.open.set(clamped > max / 2);
  }

  private maxHeight(): number {
    const parent = this.host.nativeElement.parentElement;
    return (parent?.clientHeight ?? window.innerHeight) * MAX_SHEET_FRACTION;
  }
}
