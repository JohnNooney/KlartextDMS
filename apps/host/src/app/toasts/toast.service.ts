import { Injectable, signal } from '@angular/core';

/**
 * In-app toasts (issue #28): frosted notifications — upload completion and
 * failure land here; extraction toasts (#32) reuse the same service.
 */
export type ToastTone = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const TOAST_MS = 6500;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<readonly Toast[]>([]);
  private seq = 0;

  /** Pushes a toast that dismisses itself; returns its id. */
  show(toast: Omit<Toast, 'id'>): number {
    const id = ++this.seq;
    this.toasts.update((toasts) => [...toasts, { ...toast, id }]);
    setTimeout(() => this.dismiss(id), TOAST_MS);
    return id;
  }

  dismiss(id: number): void {
    this.toasts.update((toasts) => toasts.filter((t) => t.id !== id));
  }
}
