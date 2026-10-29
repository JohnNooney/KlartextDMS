import { Component, computed, inject, input } from '@angular/core';
import { Sheet } from './sheet';

/**
 * The grab-handle strip of a detent sheet (issue #152, ADR 0014): a real
 * `<button>` — tap cycles the detents, a press drags or flicks the sheet,
 * and `aria-expanded` plus a label naming the tap's result keep the
 * control VoiceOver-operable (HIG Sheets). The 36×5 grabber pill is the
 * drag affordance; the strip's chrome lives in `sheet.scss`. Its `Sheet`
 * is the `[appSheet]` directive on the sheet element it sits inside.
 */
@Component({
  selector: 'button[appSheetHandle]',
  template: '<span class="handle-pill" aria-hidden="true"></span>',
  host: {
    type: 'button',
    class: 'sheet-handle',
    '[attr.aria-expanded]': 'expanded()',
    '[attr.aria-label]': 'label()',
    '(click)': 'sheet.cycle()',
    '(pointerdown)': 'sheet.onPointerDown($event)',
    '(pointermove)': 'sheet.onPointerMove($event)',
    '(pointerup)': 'sheet.onPointerUp($event)',
    '(pointercancel)': 'sheet.onPointerUp($event)',
  },
})
export class SheetHandle {
  protected readonly sheet = inject(Sheet);
  /** Names the tap's result — the detent a tap moves to. */
  readonly label = input.required<string>();
  protected readonly expanded = computed(() => this.sheet.expanded());
}
