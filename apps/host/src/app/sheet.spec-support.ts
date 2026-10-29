/**
 * Shared spec drivers for Sheet gesture specs (issue #152): the same
 * simulated press/drag/release the primitive's own specs and the
 * GuestFrame detent specs replay against the `.sheet-handle` button.
 * jsdom has no PointerEvent — a MouseEvent carries clientY and the
 * handlers only read pointer-agnostic fields. An explicit timeStamp fakes
 * velocity.
 */
export function sheetHandle(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('.sheet-handle')!;
}

export function sheetDetent(host: HTMLElement): string | null {
  return host.getAttribute('data-sheet');
}

export function sheetPointer(
  el: HTMLElement,
  type: string,
  clientY: number,
  timeStamp?: number,
): void {
  const event = new MouseEvent(type, { clientY, bubbles: true });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  }
  sheetHandle(el).dispatchEvent(event);
}

export function sheetTap(fixture: { detectChanges(): void }, el: HTMLElement): void {
  sheetHandle(el).click();
  fixture.detectChanges();
}
