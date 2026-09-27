import { describe, expect, it } from 'vitest';
import {
  deserializeEnvelope,
  goldenFixtures,
  isBusMessage,
  serializeEnvelope,
  type BusMessage,
  type MessageType,
} from './index.js';
import type { ExtractDocumentPayload } from './index.js';

describe('golden fixtures', () => {
  it('has exactly one fixture per message type', () => {
    const types = Object.keys(goldenFixtures).sort();
    expect(types).toEqual([
      'AI_PROCESSING_ERROR',
      'AI_PROCESSING_STARTED',
      'AI_PROCESSING_SUCCESS',
      'EXTRACT_DOCUMENT',
      'GUEST_READY',
      'INIT_SESSION',
      'RETRY_EXTRACTION',
      'SESSION_ACK',
    ]);
    expect(new Set(types).size).toBe(8);
  });

  it.each(Object.entries(goldenFixtures))('%s round-trips through the reference serializer', (type, json) => {
    const decoded = deserializeEnvelope(JSON.stringify(json));
    expect(isBusMessage(decoded)).toBe(true);
    expect(decoded.type).toBe(type as MessageType);
    expect(JSON.parse(serializeEnvelope(decoded))).toEqual(json);
  });

  it('EXTRACT_DOCUMENT carries bytes as base64 in JSON', () => {
    const decoded = deserializeEnvelope(JSON.stringify(goldenFixtures.EXTRACT_DOCUMENT));
    if (decoded.type !== 'EXTRACT_DOCUMENT') expect.unreachable();
    const payload = decoded.payload as ExtractDocumentPayload;
    expect(new TextDecoder().decode(payload.bytes)).toBe('%PDF-1.4\n');
  });
});

describe('serializeEnvelope / deserializeEnvelope', () => {
  it('does not mutate the message it serializes', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n').buffer;
    const msg: BusMessage = {
      v: 1,
      type: 'EXTRACT_DOCUMENT',
      sessionId: '',
      payload: {
        jobId: 'job-1',
        document: { documentId: 'd', documentTitle: 't', contentType: 'application/pdf' },
        bytes: bytes as ArrayBuffer,
      },
    };
    serializeEnvelope(msg);
    expect(msg.payload.bytes.byteLength).toBeGreaterThan(0);
  });

  it('passes unknown types through untouched (forward compat)', () => {
    const v2 = { v: 1, type: 'GUEST_SHOW_PAGE', sessionId: 's', payload: { page: 2 } };
    expect(deserializeEnvelope(JSON.stringify(v2))).toEqual(v2);
  });

  it('rejects JSON that is not an Envelope', () => {
    expect(() => deserializeEnvelope('"hi"')).toThrow();
    expect(() => deserializeEnvelope('{"v":2,"type":"GUEST_READY","sessionId":"","payload":{}}')).toThrow();
  });
});
