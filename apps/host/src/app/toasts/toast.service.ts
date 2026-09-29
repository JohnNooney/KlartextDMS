import { Injectable, signal } from '@angular/core';

/**
 * In-app toasts (issue #28): frosted notifications — upload completion and
 * failure land here; extraction toasts (#32) reuse the same service.
 */
export type ToastTone = 'success' | 'info' | 'error';

/** A toast's inline verb — View on completion, Try again on failure (#32). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: ToastAction;
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

  /** Runs a toast's action, if any, and dismisses the toast. */
  activate(id: number): void {
    const toast = this.toasts().find((t) => t.id === id);
    if (!toast) return;
    toast.action?.run();
    this.dismiss(id);
  }
}
