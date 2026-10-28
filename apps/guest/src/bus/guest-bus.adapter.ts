import {
  NO_SESSION,
  isBusMessage,
  isExtractionError,
  isPanelPresentation,
} from '@klartext/bus-contract';
import type {
  BusMessageEvent,
  GuestShowPagePayload,
  GuestToHostMessage,
} from '@klartext/bus-contract';
import type { GuestAdapter, GuestAdapterContext } from '@klartext/bus-contract/conformance';

/**
 * The Guest's Bus adapter (issue #26): the production counterpart of the
 * package's loopback reference, over injected `{ source, sink }` so unit
 * tests never touch `window` — in the app, `source` wraps `window` message
 * events and `sink` is `window.parent`, with the Peer Origin read off
 * `document.referrer` (no config; works on hashed preview URLs).
 *
 * `mount()` posts `GUEST_READY` — call it only after anonymous sign-in has
 * resolved, since "ready" means "can accept an Extraction Job" (issue #10).
 * Every `INIT_SESSION` is acked with `SESSION_ACK` echoing the envelope's
 * `sessionId` and applied to the probe; `EXTRACT_DOCUMENT` answers with an
 * immediate `AI_PROCESSING_STARTED` followed by the `runJob` outcome.
 * `showPage` sends `GUEST_SHOW_PAGE` (issue #78) under the current Session —
 * fire-and-forget, and silent while no Session exists. `expandPanel` and
 * `createReminder` (issues #79/#122) follow the same Session-bound pattern.
 */
export function createGuestBusAdapter(ctx: GuestAdapterContext): GuestAdapter {
  // The applied Session's id — SESSION_ACK echoes it and GUEST_SHOW_PAGE
  // travels under it (issue #78).
  let sessionId: string | null = null;

  const post = (
    type: GuestToHostMessage['type'],
    sessionId: string,
    payload: unknown,
  ): void => {
    ctx.sink.postMessage({ v: 1, type, sessionId, payload }, ctx.peerOrigin);
  };

  const onMessage = (event: BusMessageEvent): void => {
    if (event.origin !== ctx.peerOrigin || event.source !== ctx.sink) return;
    // Unknown types are ignored (forward compat) — isBusMessage filters them.
    if (!isBusMessage(event.data)) return;
    const msg = event.data;
    switch (msg.type) {
      case 'INIT_SESSION': {
        sessionId = msg.sessionId;
        post('SESSION_ACK', msg.sessionId, {});
        ctx.probe.sessionApplied(msg.payload);
        break;
      }
      case 'EXTRACT_DOCUMENT': {
        const job = msg.payload;
        post('AI_PROCESSING_STARTED', NO_SESSION, { jobId: job.jobId });
        void ctx.runJob(job).then(
          (extraction) =>
            post('AI_PROCESSING_SUCCESS', NO_SESSION, { jobId: job.jobId, extraction }),
          (err: unknown) =>
            post('AI_PROCESSING_ERROR', NO_SESSION, {
              jobId: job.jobId,
              error: isExtractionError(err)
                ? err
                : { code: 'UNKNOWN', message: 'Extraction failed.', retryable: true },
            }),
        );
        break;
      }
      case 'PANEL_PRESENTATION': {
        // An invalid `mode` is ignored (issue #77) — the payload is untrusted.
        const mode = (msg.payload as { mode?: unknown } | null)?.mode;
        if (isPanelPresentation(mode)) ctx.probe.presentationApplied(mode);
        break;
      }
      default:
        break; // Guest→Host types arriving here are ignored
    }
  };

  ctx.source.addEventListener('message', onMessage);

  return {
    mount(): void {
      post('GUEST_READY', NO_SESSION, {});
    },
    requestRetry(documentId: string): void {
      post('RETRY_EXTRACTION', NO_SESSION, { documentId });
    },
    showPage(request: GuestShowPagePayload): void {
      // Session-bound: with no Session there is no Host side listening — and
      // no takeaway rows to select anyway.
      if (sessionId === null) return;
      post('GUEST_SHOW_PAGE', sessionId, request);
    },
    expandPanel(): void {
      // Session-bound like GUEST_SHOW_PAGE (issue #79): the jump bar only
      // exists inside a Session, and the Host drops the message otherwise.
      if (sessionId === null) return;
      post('GUEST_EXPAND_PANEL', sessionId, {});
    },
    createReminder(actionItemId: string): void {
      // Session-bound like the other panel write-backs (issue #122): the
      // "Add reminder" button only exists inside a Session's Extraction,
      // and the Host drops the message for any other sessionId.
      if (sessionId === null) return;
      post('GUEST_CREATE_REMINDER', sessionId, { actionItemId });
    },
    dispose(): void {
      ctx.source.removeEventListener('message', onMessage);
    },
  };
}
