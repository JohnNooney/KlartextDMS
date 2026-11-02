import { Component, computed, input, output } from '@angular/core';
import type { BatchProgress } from '../bus/batch-reanalysis';

/**
 * The Batch re-analysis progress strip (issue #159): "Re-analyzing 3 of 14 ·
 * Cancel" with a thin bar, below the library toolbar in every Folder — never
 * in the reader (#157). After Cancel it reads "Finishing the current
 * document…" until the member already running settles.
 */
@Component({
  selector: 'app-batch-progress-strip',
  template: `
    @if (finishing() && !progress().running) {
      <div class="strip" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <span class="strip-label">Finishing the current document…</span>
      </div>
    } @else if (progress().running) {
      <div class="strip" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <span class="strip-label">Re-analyzing <b>{{ current() }} of {{ progress().total }}</b> ·</span>
        <button type="button" class="strip-cancel" (click)="cancel.emit()">Cancel</button>
        <span class="bar" [style.width.%]="percent()" aria-hidden="true"></span>
      </div>
    }
  `,
  styleUrl: './batch-progress-strip.scss',
})
export class BatchProgressStrip {
  readonly progress = input.required<BatchProgress>();
  readonly finishing = input(false);
  readonly cancel = output<void>();

  /** The member being worked on — one past those settled. */
  protected readonly current = computed(() => {
    const { done, total } = this.progress();
    return Math.min(done + 1, total);
  });

  protected readonly percent = computed(() => {
    const { done, total } = this.progress();
    return total === 0 ? 0 : (done / total) * 100;
  });
}
