import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  CURRENT_EXTRACTION_SCHEMA_VERSION,
  NO_SESSION,
  isOutdatedExtraction,
  type Envelope,
} from './index.js';

describe('bus-contract shell', () => {
  it('pins protocol version 1', () => {
    expect(BUS_PROTOCOL_VERSION).toBe(1);
  });

  it('exports the Outdated Extraction rule (ADR 0015)', () => {
    expect(CURRENT_EXTRACTION_SCHEMA_VERSION).toBe(2);
    expect(isOutdatedExtraction({ schemaVersion: 1 })).toBe(true);
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
