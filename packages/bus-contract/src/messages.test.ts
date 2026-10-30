import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  NO_SESSION,
  isBusMessage,
  isEnvelope,
  isPanelPresentation,
  sanitizeActionItemStates,
  sanitizeCreateReminder,
  sanitizeSetActionItemDone,
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
            schemaVersion: 2,
            promptVersion: 'klartext-extraction-v2',
            model: 'fake-model',
            documentType: 'OTHER',
            documentTypeLabel: 'Letter',
            sourceLanguage: 'de',
            plainEnglishSummary: 'A letter.',
            extractionStatus: 'COMPLETE',
            actionItems: [],
            keyTakeaways: [],
          },
        },
      },
      { v: 1, type: 'AI_PROCESSING_ERROR', sessionId: NO_SESSION, payload: {
        jobId: 'job-1',
        error: { code: 'AI_UNAVAILABLE', message: 'try later', retryable: true },
      } },
      { v: 1, type: 'RETRY_EXTRACTION', sessionId: NO_SESSION, payload: { documentId: 'doc-1' } },
      {
        v: 1,
        type: 'PANEL_PRESENTATION',
        sessionId: NO_SESSION,
        payload: { mode: 'lane' },
      },
      {
        v: 1,
        type: 'GUEST_SHOW_PAGE',
        sessionId: 'sess-1',
        payload: { page: 3, quote: 'Die Kündigungsfrist beträgt drei Monate.', critical: true },
      },
      { v: 1, type: 'GUEST_EXPAND_PANEL', sessionId: 'sess-1', payload: {} },
      {
        v: 1,
        type: 'GUEST_CREATE_REMINDER',
        sessionId: 'sess-1',
        payload: { actionItemId: 'ai_123' },
      },
      {
        v: 1,
        type: 'GUEST_SET_ACTION_ITEM_DONE',
        sessionId: 'sess-1',
        payload: { actionItemId: 'ai_123', done: true },
      },
      {
        v: 1,
        type: 'ACTION_ITEM_STATES',
        sessionId: 'sess-1',
        payload: { states: { ai_123: { doneAt: '2026-10-21T08:00:00.000Z', doneThrough: '2026-11-03' } } },
      },
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
      if (
        m.type === 'INIT_SESSION' ||
        m.type === 'EXTRACT_DOCUMENT' ||
        m.type === 'PANEL_PRESENTATION' ||
        m.type === 'ACTION_ITEM_STATES'
      ) {
        toGuest.push(m);
      } else {
        toHost.push(m);
      }
    }
    expect(toGuest).toHaveLength(1);
    expect(toHost).toHaveLength(1);
  });

  it('sorts PANEL_PRESENTATION into Host→Guest', () => {
    const msg: HostToGuestMessage = {
      v: 1,
      type: 'PANEL_PRESENTATION',
      sessionId: NO_SESSION,
      payload: { mode: 'sheet' },
    };
    expect(msg.payload.mode).toBe('sheet');
  });
});

describe('isPanelPresentation', () => {
  it.each(['lane', 'sheet'] as const)('accepts %s', (mode) => {
    expect(isPanelPresentation(mode)).toBe(true);
  });

  it.each([
    ['an unknown mode', 'drawer'],
    ['a non-string', 3],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isPanelPresentation(value)).toBe(false);
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

describe('sanitizeCreateReminder', () => {
  it('accepts a non-empty actionItemId and strips extras', () => {
    expect(
      sanitizeCreateReminder({ actionItemId: 'ai_9f', page: 3, quote: 7 }),
    ).toEqual({ actionItemId: 'ai_9f' });
  });

  it.each([
    ['a missing id', {}],
    ['an empty id', { actionItemId: '' }],
    ['a non-string id', { actionItemId: 7 }],
    ['null', null],
    ['a string', 'ai_9f'],
  ])('rejects %s', (_label, payload) => {
    expect(sanitizeCreateReminder(payload)).toBeNull();
  });
});

describe('sanitizeSetActionItemDone', () => {
  it('accepts an id and a boolean done, stripping extras', () => {
    expect(
      sanitizeSetActionItemDone({ actionItemId: 'ai_9f', done: false, page: 3 }),
    ).toEqual({ actionItemId: 'ai_9f', done: false });
  });

  it.each([
    ['a missing id', { done: true }],
    ['an empty id', { actionItemId: '', done: true }],
    ['a non-string id', { actionItemId: 7, done: true }],
    ['a missing done', { actionItemId: 'ai_9f' }],
    ['a non-boolean done', { actionItemId: 'ai_9f', done: 'yes' }],
    ['null', null],
    ['a string', 'ai_9f'],
  ])('rejects %s', (_label, payload) => {
    expect(sanitizeSetActionItemDone(payload)).toBeNull();
  });
});

describe('sanitizeActionItemStates', () => {
  it('accepts a map of well-formed states and strips extras', () => {
    expect(
      sanitizeActionItemStates({
        states: {
          ai_1: { doneAt: '2026-10-21T08:00:00.000Z', doneThrough: '2026-11-03', extra: 1 },
          ai_2: { doneAt: '2026-10-18T17:32:11.000Z' },
        },
        other: true,
      }),
    ).toEqual({
      ai_1: { doneAt: '2026-10-21T08:00:00.000Z', doneThrough: '2026-11-03' },
      ai_2: { doneAt: '2026-10-18T17:32:11.000Z' },
    });
  });

  it('strips malformed entries but keeps the well-formed ones', () => {
    expect(
      sanitizeActionItemStates({
        states: {
          good: { doneAt: 'x' },
          missingDoneAt: { doneThrough: '2026-11-03' },
          nonObject: 7,
          badThrough: { doneAt: 'x', doneThrough: 3 },
        },
      }),
    ).toEqual({
      good: { doneAt: 'x' },
      badThrough: { doneAt: 'x' },
    });
  });

  it.each([
    ['a missing states', {}],
    ['a non-object states', { states: 'done' }],
    ['an array states', { states: [] }],
    ['null', null],
    ['a string', 'states'],
  ])('rejects %s', (_label, payload) => {
    expect(sanitizeActionItemStates(payload)).toBeNull();
  });
});

describe('isBusMessage', () => {
  it('rejects unknown types so both apps ignore them (forward compat)', () => {
    const v2 = { v: BUS_PROTOCOL_VERSION, type: 'AUTH_TOKEN_REFRESHED', sessionId: 's', payload: { token: 'x' } };
    expect(isEnvelope(v2)).toBe(true);
    expect(isBusMessage(v2)).toBe(false);
  });
});
