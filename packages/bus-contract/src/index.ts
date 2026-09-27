/**
 * Bus contract — the `{ v, type, sessionId, payload }` Envelope shape every
 * Host↔Guest message takes (issue #7, amended by #12).
 *
 * Scaffold shell: only the Envelope spine is pinned here. Message types,
 * Session, and Extraction payloads are filled by the bus-contract issue (#24).
 */

export const BUS_PROTOCOL_VERSION = 1;

/**
 * `sessionId` is Host-generated per INIT_SESSION and echoed by the Guest.
 * Messages outside a Session — `GUEST_READY` and Extraction Job messages —
 * carry `""`.
 */
export const NO_SESSION = '';

export interface Envelope<TType extends string = string, TPayload = unknown> {
  v: typeof BUS_PROTOCOL_VERSION;
  type: TType;
  sessionId: string;
  payload: TPayload;
}
