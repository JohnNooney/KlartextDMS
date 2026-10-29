import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DiscardChangesAlert } from './discard-changes-alert';

async function setup() {
  await TestBed.configureTestingModule({ imports: [DiscardChangesAlert] }).compileComponents();
  const fixture = TestBed.createComponent(DiscardChangesAlert);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  let kept = 0;
  let discarded = 0;
  fixture.componentInstance.kept.subscribe(() => kept++);
  fixture.componentInstance.discarded.subscribe(() => discarded++);
  return { el, emitted: () => ({ kept, discarded }) };
}

describe('DiscardChangesAlert (issue #151)', () => {
  it('is a centred alertdialog titled "Discard changes?"', async () => {
    const { el } = await setup();
    const alert = el.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-modal')).toBe('true');
    expect(alert.querySelector('h2')!.textContent).toContain('Discard changes?');
    expect(alert.querySelector('.btn-danger')!.textContent).toContain('Discard');
  });

  it('focuses Keep Editing — the default, non-destructive pick', async () => {
    const { el } = await setup();
    const keep = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent!.includes('Keep Editing'),
    )!;
    expect(document.activeElement).toBe(keep);
  });

  it('Escape picks Keep Editing — implicit close is never destructive', async () => {
    const { emitted } = await setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(emitted()).toEqual({ kept: 1, discarded: 0 });
  });

  it('a backdrop click picks Keep Editing', async () => {
    const { el, emitted } = await setup();
    el.querySelector<HTMLButtonElement>('.backdrop')!.click();
    expect(emitted()).toEqual({ kept: 1, discarded: 0 });
  });

  it('Discard emits discarded', async () => {
    const { el, emitted } = await setup();
    el.querySelector<HTMLButtonElement>('.btn-danger')!.click();
    expect(emitted()).toEqual({ kept: 0, discarded: 1 });
  });
});
