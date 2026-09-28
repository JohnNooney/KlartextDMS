import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    return TestBed.inject(ToastService);
  }

  it('shows a toast and auto-dismisses it', () => {
    const toasts = setup();
    toasts.show({ tone: 'success', title: 'Uploaded rechnung.pdf' });
    expect(toasts.toasts()).toHaveLength(1);
    expect(toasts.toasts()[0]).toMatchObject({ tone: 'success', title: 'Uploaded rechnung.pdf' });

    vi.advanceTimersByTime(6500);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('stacks multiple toasts, newest last', () => {
    const toasts = setup();
    toasts.show({ tone: 'info', title: 'one' });
    toasts.show({ tone: 'error', title: 'two', body: 'bild.png' });
    expect(toasts.toasts().map((t) => t.title)).toEqual(['one', 'two']);
  });

  it('dismiss removes a toast early', () => {
    const toasts = setup();
    const id = toasts.show({ tone: 'success', title: 'x' });
    toasts.dismiss(id);
    expect(toasts.toasts()).toHaveLength(0);
    // The cleared timer must not fire a second dismiss for a stale id.
    vi.advanceTimersByTime(10_000);
    expect(toasts.toasts()).toHaveLength(0);
  });
});
