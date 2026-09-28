import { describe, expect, it, vi } from 'vitest';
import type {
  BusMessageEvent,
  BusMessageListener,
  BusSink,
  BusSource,
} from '@klartext/bus-contract';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import { createHostBusAdapter } from './host-bus.adapter';
import type { HostBusProbe } from './host-bus.adapter';

const PEER_ORIGIN = 'http://guest.test';

class FakeSource implements BusSource {
  private listener: BusMessageListener | null = null;
  addEventListener(_type: 'message', listener: BusMessageListener): void {
    this.listener = listener;
  }
  removeEventListener(): void {
    this.listener = null;
  }
  emit(event: BusMessageEvent): void {
    this.listener?.(event);
  }
}

function setup() {
  const source = new FakeSource();
  const sink: BusSink = { postMessage: vi.fn() };
  const probe: Required<HostBusProbe> = {
    onGuestReady: vi.fn(),
    sessionFailed: vi.fn(),
    jobSucceeded: vi.fn(),
    jobFailed: vi.fn(),
    jobStarted: vi.fn(),
    jobFailedFor: vi.fn(),
    retryRequested: vi.fn(() => false),
  };
  const adapter = createHostBusAdapter({ source, sink, peerOrigin: PEER_ORIGIN, probe });
  return { source, sink, probe, adapter };
}

const GUEST_READY = { v: 1, type: 'GUEST_READY', sessionId: '', payload: {} };

describe('HostBus adapter — receive-side checks', () => {
  it('ignores messages from an origin other than the Peer Origin', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: GUEST_READY, origin: 'http://evil.test', source: sink });
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages whose source is not the Guest iframe window', () => {
    const { source, sink, probe } = setup();
    const stranger: BusSink = { postMessage: vi.fn() };
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: stranger });
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores non-Envelope payloads without crashing', () => {
    const { source, sink, probe } = setup();
    for (const data of ['not an envelope', 42, null, { v: 2 }, { type: 'GUEST_READY' }]) {
      source.emit({ data, origin: PEER_ORIGIN, source: sink });
    }
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('accepts a genuine GUEST_READY from the Guest window', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    expect(probe.onGuestReady).toHaveBeenCalledOnce();
  });
});

describe('HostBus adapter — app-side probe hooks (issue #31)', () => {
  const document = { documentId: 'doc-1', documentTitle: 'Mietvertrag', contentType: 'application/pdf' };

  function dispatch(
    source: FakeSource,
    sink: BusSink,
    adapter: { requestExtraction(d: typeof document, b: ArrayBuffer): void },
  ): string {
    adapter.requestExtraction(document, new ArrayBuffer(4));
    const call = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([data]) => (data as { type?: string }).type === 'EXTRACT_DOCUMENT',
    )!;
    return (call[0] as { payload: { jobId: string } }).payload.jobId;
  }

  it('reports the job and its Document when STARTED acks the dispatch', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobStarted).toHaveBeenCalledWith(jobId, document);
  });

  it('reports the failing job\'s Document alongside the error', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    const error = { code: 'INVALID_EXTRACTION', message: 'Unreadable.', retryable: true };
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_ERROR', sessionId: '', payload: { jobId, error } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobFailed).toHaveBeenCalledWith(jobId, error);
    expect(probe.jobFailedFor).toHaveBeenCalledWith(jobId, document, error);
  });

  it('fails INVALID_EXTRACTION when SUCCESS carries a foreign documentId', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });
    const extraction = {
      ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
      documentId: 'doc-other',
    };

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_SUCCESS', sessionId: '', payload: { jobId, extraction } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobSucceeded).not.toHaveBeenCalled();
    expect(probe.jobFailed).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ code: 'INVALID_EXTRACTION', retryable: true }),
    );
  });

  it('fails INVALID_EXTRACTION when SUCCESS carries a malformed Extraction', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    source.emit({
      data: {
        v: 1,
        type: 'AI_PROCESSING_SUCCESS',
        sessionId: '',
        payload: { jobId, extraction: { documentId: 'doc-1' } },
      },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobSucceeded).not.toHaveBeenCalled();
    expect(probe.jobFailed).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ code: 'INVALID_EXTRACTION' }),
    );
  });

  it('lets the app own the re-enqueue when retryRequested accepts', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    dispatch(source, sink, adapter);
    vi.mocked(probe.retryRequested).mockReturnValue(true);

    source.emit({
      data: { v: 1, type: 'RETRY_EXTRACTION', sessionId: '', payload: { documentId: 'doc-1' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.retryRequested).toHaveBeenCalledWith('doc-1');
    const dispatches = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([data]) => (data as { type?: string }).type === 'EXTRACT_DOCUMENT',
    );
    expect(dispatches).toHaveLength(1);
  });

  it('re-queues from its own job table when the app declines retry ownership', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const firstJobId = dispatch(source, sink, adapter);
    vi.mocked(probe.retryRequested).mockReturnValue(false);

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId: firstJobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });
    source.emit({
      data: {
        v: 1,
        type: 'AI_PROCESSING_ERROR',
        sessionId: '',
        payload: { jobId: firstJobId, error: { code: 'UNKNOWN', message: 'x', retryable: true } },
      },
      origin: PEER_ORIGIN,
      source: sink,
    });
    source.emit({
      data: { v: 1, type: 'RETRY_EXTRACTION', sessionId: '', payload: { documentId: 'doc-1' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    const dispatches = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([data]) => data as { type: string; payload: { jobId: string } })
      .filter((d) => d.type === 'EXTRACT_DOCUMENT');
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]!.payload.jobId).not.toBe(firstJobId);
  });
});
