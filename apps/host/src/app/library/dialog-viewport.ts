import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Keeps a `.dialog` inside the *visual* viewport (issue #64): on iOS the
 * on-screen keyboard shrinks the visual viewport while `position: fixed`
 * keeps resolving against the layout viewport, so a 50%-centred dialog ends
 * up under the keyboard. Tracking `visualViewport` re-centres the dialog in
 * the visible band and caps its height, so every field stays reachable.
 */
@Directive({ selector: '.dialog' })
export class DialogViewport {
  constructor() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const place = () => {
      el.style.top = `${viewport.offsetTop + viewport.height / 2}px`;
      // Mirrors the stylesheet's 48px margin (dialogs.scss `max-height`).
      el.style.maxHeight = `${Math.max(viewport.height - 48, 0)}px`;
    };
    viewport.addEventListener('resize', place);
    viewport.addEventListener('scroll', place);
    inject(DestroyRef).onDestroy(() => {
      viewport.removeEventListener('resize', place);
      viewport.removeEventListener('scroll', place);
    });
    place();
  }
}
