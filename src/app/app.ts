import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { AddressSearch } from './components/address-search/address-search';
import { MapView } from './components/map-view/map-view';
import { SpotList } from './components/spot-list/spot-list';
import { SpotPanel } from './components/spot-panel/spot-panel';

/** Pointer movement (px) before a press on the handle counts as a drag instead of a tap. */
const DRAG_THRESHOLD = 4;
/** Smallest sheet height (px) when dragged; keeps the handle reachable. */
const MIN_SHEET_HEIGHT = 56;
/** Largest sheet height as a fraction of the area below the top bar. */
const MAX_SHEET_FRACTION = 0.9;

@Component({
  selector: 'app-root',
  imports: [AddressSearch, MapView, SpotList, SpotPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Mobile bottom sheet: collapsed shows the spot list, expanded shows everything. */
  protected readonly sheetOpen = signal(false);
  /** Height (px) the user dragged the sheet to; null uses the collapsed/expanded preset. */
  protected readonly sheetHeight = signal<number | null>(null);
  protected readonly dragging = signal(false);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private drag: { pointerId: number; startY: number; startHeight: number; moved: boolean } | null = null;
  private suppressClick = false;

  protected toggleSheet(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.sheetHeight.set(null);
    this.sheetOpen.update((open) => !open);
  }

  protected onHandlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: this.panel().nativeElement.getBoundingClientRect().height,
      moved: false,
    };
  }

  protected onHandlePointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dy = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    this.dragging.set(true);
    this.setSheetHeight(drag.startHeight + dy);
  }

  protected onHandlePointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.dragging.set(false);
    // A drag is followed by a click on the button; don't let it toggle the sheet.
    this.suppressClick = drag.moved && event.type === 'pointerup';
  }

  protected onHandleKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = this.panel().nativeElement.getBoundingClientRect().height;
    this.setSheetHeight(current + step * this.maxSheetHeight() * 0.1);
  }

  private setSheetHeight(height: number): void {
    const max = this.maxSheetHeight();
    const clamped = Math.min(Math.max(height, MIN_SHEET_HEIGHT), max);
    this.sheetHeight.set(clamped);
    this.sheetOpen.set(clamped > max / 2);
  }

  private maxSheetHeight(): number {
    const layout = this.panel().nativeElement.parentElement;
    return (layout?.clientHeight ?? window.innerHeight) * MAX_SHEET_FRACTION;
  }
}
