import { describe, expect, it } from 'vitest';
import { emulatorConfig, firebaseConfig } from './index.js';

describe('firebase-config shell', () => {
  it('targets the provisioned project', () => {
    expect(firebaseConfig.projectId).toBe('klartext-b836c');
    expect(firebaseConfig.apiKey).toBeTruthy();
    expect(firebaseConfig.appId).toBeTruthy();
    expect(firebaseConfig.storageBucket).toContain('klartext-b836c');
  });

  it('pins the emulator ports from the storage decision', () => {
    expect(emulatorConfig).toEqual({
      host: 'localhost',
      auth: { port: 9099 },
      firestore: { port: 8080 },
      storage: { port: 9199 },
    });
  });
});
