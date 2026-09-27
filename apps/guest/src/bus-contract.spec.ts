// Verifies the shared contract package resolves source-level (no build step)
// and the exported conformance suite runs inside the Guest's Vitest. Until the
// real Host/Guest Bus adapters land (app shell tickets), the suite runs
// against the package's loopback reference adapters; the adapter specs will
// re-run it against the real implementations.
import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  deserializeEnvelope,
  goldenFixtures,
  serializeEnvelope,
} from '@klartext/bus-contract';
import { runBusContractConformance } from '@klartext/bus-contract/conformance';
import {
  createLoopbackGuestAdapter,
  createLoopbackHostAdapter,
} from '@klartext/bus-contract/testing';

describe('bus-contract (source-level import)', () => {
  it('exposes the protocol and golden fixtures', () => {
    expect(BUS_PROTOCOL_VERSION).toBe(1);
    expect(Object.keys(goldenFixtures)).toHaveLength(8);
  });

  it('round-trips every golden fixture through the reference serializer', () => {
    for (const fixture of Object.values(goldenFixtures)) {
      const decoded = deserializeEnvelope(JSON.stringify(fixture));
      expect(JSON.parse(serializeEnvelope(decoded))).toEqual(fixture);
    }
  });
});

runBusContractConformance({
  createHost: createLoopbackHostAdapter,
  createGuest: createLoopbackGuestAdapter,
});
