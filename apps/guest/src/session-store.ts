import { shallowRef } from 'vue';
import { goldenFixtureMessages, type Session } from '@klartext/bus-contract';
import type { GuestProbe } from '@klartext/bus-contract/conformance';

/**
 * The Session the Host handed the Guest (issue #26): null before the first
 * INIT_SESSION — the panel's pre-Session empty state. Replaced wholesale on
 * every applied Session, including the Host's resend when the job for the
 * open Document completes.
 */
export const currentSession = shallowRef<Session | null>(null);

/** The Bus adapter's probe: an applied Session replaces the panel's content. */
export const sessionProbe: GuestProbe = {
  sessionApplied(session: Session): void {
    currentSession.value = session;
  },
};

/**
 * Standalone dev (`vite` on :5173 with no embedding Host) fills the panel
 * with the golden fixture Session so the layout is exercised end to end.
 */
export function loadFixtureSession(): void {
  sessionProbe.sessionApplied(goldenFixtureMessages.INIT_SESSION.payload);
}

/**
 * The Bus adapter's retry sender (issue #31), wired by main.ts once the
 * adapter exists. `RETRY_EXTRACTION` is the Guest's only write-back: it asks
 * the Host to enqueue an Extraction Job — both "Analyze document" and
 * "Re-analyze document"/"Try again" funnel through it.
 */
export const retrySender = shallowRef<((documentId: string) => void) | null>(null);

export function requestRetry(documentId: string): void {
  retrySender.value?.(documentId);
}
