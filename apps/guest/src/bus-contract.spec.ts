// Verifies the shared contract package resolves source-level (no build step)
// and the exported conformance suite runs inside the Guest's Vitest. The Guest
// side runs against the real adapter (issue #26); the Host side uses the
// package's loopback reference — the Host's own Vitest pins the real Host
// adapter the same way.
import { describe, expect, it } from 'vitest';
import {
  BUS_PROTOCOL_VERSION,
  deserializeEnvelope,
  goldenFixtures,
  serializeEnvelope,
} from '@klartext/bus-contract';
import { runBusContractConformance } from '@klartext/bus-contract/conformance';
import { createLoopbackHostAdapter } from '@klartext/bus-contract/testing';
import { createGuestBusAdapter } from './bus/guest-bus.adapter';

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
  createGuest: createGuestBusAdapter,
});
