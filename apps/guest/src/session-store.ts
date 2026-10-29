import { shallowRef } from 'vue';
import {
  doneMark,
  goldenFixtureMessages,
  type ActionItemStates,
  type GuestShowPagePayload,
  type IdentifiedActionItem,
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

/**
 * The open Document's Done marks (issue #144, ADR 0013): seeded by the
 * Session, optimistically updated by the mark-done check, and replaced
 * wholesale by the Host's ACTION_ITEM_STATES push — the authoritative map,
 * which confirms or rolls back an optimistic mark.
 */
export const actionItemStates = shallowRef<ActionItemStates>({});

/** The Bus adapter's probe: an applied Session replaces the panel's content. */
export const sessionProbe: GuestProbe = {
  sessionApplied(session: Session): void {
    currentSession.value = session;
    actionItemStates.value = session.actionItemStates ?? {};
  },
  presentationApplied(mode: PanelPresentation): void {
    presentationMode.value = mode;
  },
  actionItemStatesApplied(states: ActionItemStates): void {
    actionItemStates.value = states;
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

/**
 * The Bus adapter's reminder sender (issue #122), wired by main.ts once the
 * adapter exists. An Action Item's "Add reminder" sends
 * `GUEST_CREATE_REMINDER` — the Host owns the dialog and the export;
 * fire-and-forget since Klartext never tracks a Reminder.
 */
export const reminderSender = shallowRef<((actionItemId: string) => void) | null>(null);

export function createReminder(actionItemId: string): void {
  reminderSender.value?.(actionItemId);
}

/**
 * The Bus adapter's mark-done sender (issue #144), wired by main.ts once
 * the adapter exists. The check updates the local map optimistically —
 * `doneMark` gives a computable recurrence its `doneThrough` like the
 * Host's write does — then asks the Host; its ACTION_ITEM_STATES push
 * confirms or rolls back. Standalone dev still flips the mark locally.
 */
export const doneSender = shallowRef<((actionItemId: string, done: boolean) => void) | null>(null);

export function setActionItemDone(item: IdentifiedActionItem, done: boolean): void {
  const states = { ...actionItemStates.value };
  if (done) states[item.id] = doneMark(item, new Date());
  else delete states[item.id];
  actionItemStates.value = states;
  doneSender.value?.(item.id, done);
}
