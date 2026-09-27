// Verifies the shared contract package resolves source-level (no build step)
// and the exported conformance suite runs inside the Host's Vitest. The Host
// side runs against the real adapter (issue #25); the Guest side uses the
// package's loopback reference until the Guest shell lands (#26).
import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  deserializeEnvelope,
  goldenFixtures,
  serializeEnvelope,
} from '@klartext/bus-contract';
import { runBusContractConformance } from '@klartext/bus-contract/conformance';
import { createLoopbackGuestAdapter } from '@klartext/bus-contract/testing';
import { createHostBusAdapter } from './bus/host-bus.adapter';

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
  createHost: createHostBusAdapter,
  createGuest: createLoopbackGuestAdapter,
});
