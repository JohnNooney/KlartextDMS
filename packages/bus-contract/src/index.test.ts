import { describe, expect, it } from 'vitest';
import { BUS_PROTOCOL_VERSION, NO_SESSION, type Envelope } from './index.js';

describe('bus-contract shell', () => {
  it('pins protocol version 1', () => {
    expect(BUS_PROTOCOL_VERSION).toBe(1);
  });

  it('frames a message as { v, type, sessionId, payload }', () => {
    const envelope: Envelope<'GUEST_READY', Record<string, never>> = {
      v: BUS_PROTOCOL_VERSION,
      type: 'GUEST_READY',
      sessionId: NO_SESSION,
      payload: {},
    };
    expect(envelope.sessionId).toBe('');
  });
});
