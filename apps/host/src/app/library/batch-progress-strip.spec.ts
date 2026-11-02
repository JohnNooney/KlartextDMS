import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BatchProgress } from '../bus/batch-reanalysis';
import { BatchProgressStrip } from './batch-progress-strip';

async function setup(progress: BatchProgress, finishing = false) {
  await TestBed.configureTestingModule({ imports: [BatchProgressStrip] }).compileComponents();
  const fixture = TestBed.createComponent(BatchProgressStrip);
  fixture.componentRef.setInput('progress', progress);
  fixture.componentRef.setInput('finishing', finishing);
  fixture.detectChanges();
  let cancelled = 0;
  fixture.componentInstance.cancel.subscribe(() => cancelled++);
  const el = fixture.nativeElement as HTMLElement;
  return { el, text: () => el.textContent!.replace(/\s+/g, ' ').trim(), cancelled: () => cancelled };
}

// Issue #159: the strip below the library toolbar.
describe('BatchProgressStrip', () => {
  it('reads "Re-analyzing 3 of 14 · Cancel" with the bar at the settled share', async () => {
    const h = await setup({ running: true, done: 2, total: 14 });
    expect(h.text()).toBe('Re-analyzing 3 of 14 ·Cancel');
    expect(h.el.querySelector<HTMLElement>('.bar')!.style.width).toBe(`${(2 / 14) * 100}%`);

    h.el.querySelector<HTMLButtonElement>('.strip-cancel')!.click();
    expect(h.cancelled()).toBe(1);
  });

  it('reads "Finishing the current document…" after Cancel, with no Cancel', async () => {
    const h = await setup({ running: false, done: 0, total: 0 }, true);
    expect(h.text()).toBe('Finishing the current document…');
    expect(h.el.querySelector('.strip-cancel')).toBeNull();
  });

  it('renders nothing while idle', async () => {
    const h = await setup({ running: false, done: 0, total: 0 });
    expect(h.el.querySelector('.strip')).toBeNull();
  });
});
