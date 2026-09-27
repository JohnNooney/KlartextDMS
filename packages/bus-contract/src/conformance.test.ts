import { runBusContractConformance } from './conformance.js';
import { createLoopbackGuestAdapter, createLoopbackHostAdapter } from './testing.js';

// The contract's own Vitest run exercises the exported conformance suite
// against the package's trivial loopback adapters (issue #24).
runBusContractConformance({
  createHost: createLoopbackHostAdapter,
  createGuest: createLoopbackGuestAdapter,
});
