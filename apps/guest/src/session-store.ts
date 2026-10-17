import { shallowRef } from 'vue';
import {
  goldenFixtureMessages,
  type GuestShowPagePayload,
  type PanelPresentation,
  type Session,
} from '@klartext/bus-contract';
import type { GuestProbe } from '@klartext/bus-contract/conformance';

/**
 * The Session the Host handed the Guest (issue #26): null before the first
 * INIT_SESSION — the panel's pre-Session empty state. Replaced wholesale on
 * every applied Session, including the Host's resend when the job for the
 * open Document completes.
 */
export const currentSession = shallowRef<Session | null>(null);

/**
 * How the Host presents the Guest frame (issue #77): `lane` renders the
 * outline rail, `sheet` — and the time before the first PANEL_PRESENTATION
 * arrives — renders without section navigation.
 */
export const presentationMode = shallowRef<PanelPresentation | null>(null);

/** The Bus adapter's probe: an applied Session replaces the panel's content. */
export const sessionProbe: GuestProbe = {
  sessionApplied(session: Session): void {
    currentSession.value = session;
  },
  presentationApplied(mode: PanelPresentation): void {
    presentationMode.value = mode;
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

/**
 * The Bus adapter's page sender (issue #78), wired by main.ts once the
 * adapter exists. A selected Key Takeaway row with a `page` turns into
 * `GUEST_SHOW_PAGE` — fire-and-forget; standalone dev has no Host and sends
 * nothing.
 */
export const showPageSender = shallowRef<((request: GuestShowPagePayload) => void) | null>(null);

export function showPage(request: GuestShowPagePayload): void {
  showPageSender.value?.(request);
}

/**
 * The Bus adapter's expand sender (issue #79), wired by main.ts once the
 * adapter exists. A jump-bar tap in the sheet sends `GUEST_EXPAND_PANEL` —
 * the Guest can't raise its own frame; the Host lifts a peeking sheet to
 * half and ignores the request at every other detent.
 */
export const expandPanelSender = shallowRef<(() => void) | null>(null);

export function expandPanel(): void {
  expandPanelSender.value?.();
}
