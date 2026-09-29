import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ToastOutlet } from './toast-outlet';
import { ToastService } from './toast.service';

/** The toast stack's action affordance (issue #32): View / Try again. */
describe('ToastOutlet', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [ToastOutlet] }).compileComponents();
    const fixture = TestBed.createComponent(ToastOutlet);
    fixture.detectChanges();
    return { fixture, toasts: TestBed.inject(ToastService), el: fixture.nativeElement as HTMLElement };
  }

  it('renders a toast action as a button that runs it and dismisses the toast', async () => {
    const { fixture, toasts, el } = await setup();
    const run = vi.fn();
    toasts.show({ tone: 'success', title: '"Mietvertrag" is ready', action: { label: 'View', run } });
    fixture.detectChanges();

    const button = el.querySelector<HTMLButtonElement>('.toast-action');
    expect(button?.textContent?.trim()).toBe('View');

    button!.click();
    fixture.detectChanges();
    expect(run).toHaveBeenCalledOnce();
    expect(el.querySelector('.toast')).toBeNull();
  });

  it('renders no action button for a plain toast', async () => {
    const { fixture, toasts, el } = await setup();
    toasts.show({ tone: 'info', title: 'x' });
    fixture.detectChanges();
    expect(el.querySelector('.toast-action')).toBeNull();
  });
});
