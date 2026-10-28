import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

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
      // Edge-anchored variants (the Reminder sheet fills a phone) keep
      // their own placement and may fill the visible band — only centred
      // dialogs get the 48px margin (issue #122).
      const bottom = getComputedStyle(el).bottom;
      const anchored = bottom !== 'auto' && bottom !== '';
      el.style.top = anchored ? '' : `${viewport.offsetTop + viewport.height / 2}px`;
      // Mirrors the stylesheet's 48px margin (dialogs.scss `max-height`).
      el.style.maxHeight = `${Math.max(viewport.height - (anchored ? 0 : 48), 0)}px`;
    };
    viewport.addEventListener('resize', place);
    viewport.addEventListener('scroll', place);
    inject(DestroyRef).onDestroy(() => {
      viewport.removeEventListener('resize', place);
      viewport.removeEventListener('scroll', place);
    });
    // The constructor runs while the element is still detached, where
    // getComputedStyle reports `bottom: auto` and misreads edge-anchored
    // variants as centred — wait until the dialog is in the DOM (issue #122).
    afterNextRender(place);
  }
}
