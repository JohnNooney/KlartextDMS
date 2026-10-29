import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

/**
 * The menu half of DialogViewport's job (issue #149, ADR 0014): a `.menu`
 * opens below its trigger unless that would push it past the bottom of the
 * *visual* viewport — then `.is-up` opens it above instead, so a tile menu
 * on the last grid row never runs off-screen. One measurement per element
 * is enough: every Host menu is `@if`-created on open and destroyed on
 * close.
 */
@Directive({ selector: '.menu' })
export class MenuViewport {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      if (el.getBoundingClientRect().bottom > bottom) el.classList.add('is-up');
    });
  }
}
