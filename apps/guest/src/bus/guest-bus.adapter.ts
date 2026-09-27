import { NO_SESSION, isBusMessage, isExtractionError } from '@klartext/bus-contract';
import type { BusMessageEvent, GuestToHostMessage } from '@klartext/bus-contract';
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
 */
export function createGuestBusAdapter(ctx: GuestAdapterContext): GuestAdapter {
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
    dispose(): void {
      ctx.source.removeEventListener('message', onMessage);
    },
  };
}
