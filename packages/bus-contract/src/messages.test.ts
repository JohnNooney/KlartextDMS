import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  NO_SESSION,
  isBusMessage,
  isEnvelope,
  type BusMessage,
  type GuestToHostMessage,
  type HostToGuestMessage,
  type Session,
} from './index.js';

const session: Session = {
  sessionId: 'sess-1',
  documentId: 'doc-1',
  documentTitle: 'Mietvertrag 2024.pdf',
  user: { uid: 'u-1', displayName: 'Ada', email: 'ada@example.com' },
  authToken: 'opaque-token',
  extraction: null,
  extractionState: 'none',
};

describe('BusMessage union', () => {
  it('covers every contract message type', () => {
    const messages: BusMessage[] = [
      { v: 1, type: 'INIT_SESSION', sessionId: 'sess-1', payload: session },
      {
        v: 1,
        type: 'EXTRACT_DOCUMENT',
        sessionId: NO_SESSION,
        payload: {
          jobId: 'job-1',
          document: { documentId: 'doc-1', documentTitle: 'Doc', contentType: 'application/pdf' },
          bytes: new ArrayBuffer(0),
        },
      },
      { v: 1, type: 'GUEST_READY', sessionId: NO_SESSION, payload: {} },
      { v: 1, type: 'SESSION_ACK', sessionId: 'sess-1', payload: {} },
      { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: NO_SESSION, payload: { jobId: 'job-1' } },
      {
        v: 1,
        type: 'AI_PROCESSING_SUCCESS',
        sessionId: NO_SESSION,
        payload: {
          jobId: 'job-1',
          extraction: {
            documentId: 'doc-1',
            schemaVersion: 1,
            promptVersion: 'klartext-extraction-v1',
            model: 'fake-model',
            documentType: 'OTHER',
            documentTypeLabel: 'Letter',
            sourceLanguage: 'de',
            plainEnglishSummary: 'A letter.',
            extractionStatus: 'COMPLETE',
            keyTakeaways: [],
          },
        },
      },
      { v: 1, type: 'AI_PROCESSING_ERROR', sessionId: NO_SESSION, payload: {
        jobId: 'job-1',
        error: { code: 'AI_UNAVAILABLE', message: 'try later', retryable: true },
      } },
      { v: 1, type: 'RETRY_EXTRACTION', sessionId: NO_SESSION, payload: { documentId: 'doc-1' } },
    ];
    for (const m of messages) expect(isBusMessage(m)).toBe(true);
  });

  it('narrows payload by discriminating on type', () => {
    const msg: BusMessage = {
      v: 1,
      type: 'AI_PROCESSING_STARTED',
      sessionId: NO_SESSION,
      payload: { jobId: 'job-9' },
    };
    if (msg.type === 'AI_PROCESSING_STARTED') {
      expect(msg.payload.jobId).toBe('job-9');
    } else {
      expect.unreachable();
    }
  });

  it('splits the union into direction unions', () => {
    const toGuest: HostToGuestMessage[] = [];
    const toHost: GuestToHostMessage[] = [];
    const sample: BusMessage[] = [
      { v: 1, type: 'INIT_SESSION', sessionId: 's', payload: session },
      { v: 1, type: 'RETRY_EXTRACTION', sessionId: '', payload: { documentId: 'd' } },
    ];
    for (const m of sample) {
      if (m.type === 'INIT_SESSION' || m.type === 'EXTRACT_DOCUMENT') toGuest.push(m);
      else toHost.push(m);
    }
    expect(toGuest).toHaveLength(1);
    expect(toHost).toHaveLength(1);
  });
});

describe('isEnvelope', () => {
  it('accepts the Envelope spine', () => {
    expect(isEnvelope({ v: 1, type: 'ANYTHING', sessionId: '', payload: {} })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'GUEST_READY'],
    ['wrong version', { v: 2, type: 'GUEST_READY', sessionId: '', payload: {} }],
    ['missing payload', { v: 1, type: 'GUEST_READY', sessionId: '' }],
    ['non-string type', { v: 1, type: 7, sessionId: '', payload: {} }],
    ['non-string sessionId', { v: 1, type: 'GUEST_READY', sessionId: 3, payload: {} }],
  ])('rejects %s', (_label, value) => {
    expect(isEnvelope(value)).toBe(false);
  });
});

describe('isBusMessage', () => {
  it('rejects unknown types so both apps ignore them (forward compat)', () => {
    const v2 = { v: BUS_PROTOCOL_VERSION, type: 'GUEST_SHOW_PAGE', sessionId: 's', payload: { page: 3 } };
    expect(isEnvelope(v2)).toBe(true);
    expect(isBusMessage(v2)).toBe(false);
  });
});
