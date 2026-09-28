// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #27). The committed `firestore.rules`/`storage.rules` are the real
// perimeter (issue #21/#25): owner happy path, non-owner denied, >10 MB
// denied, non-PDF denied — the input boundary's server-side mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { emulatorConfig } from '@klartext/firebase-config';
import { INTEGRATION_OWNER_EMAIL } from './app/data/testing';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'klartext-b836c',
    firestore: {
      rules: readRepoFile('firestore.rules'),
      host: emulatorConfig.host,
      port: emulatorConfig.firestore.port,
    },
    storage: {
      rules: readRepoFile('storage.rules'),
      host: emulatorConfig.host,
      port: emulatorConfig.storage.port,
    },
  });
});

afterAll(() => testEnv.cleanup());

function readRepoFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url)), 'utf8');
}

describe('committed rules (issue #27)', () => {
  describe('firestore.rules', () => {
    it('owner happy path: create, read, update, delete own Document', async () => {
      const owner = testEnv.authenticatedContext('owner-a', {
        email: INTEGRATION_OWNER_EMAIL,
      });
      const db = owner.firestore();
      const ref = db.doc('users/owner-a/documents/rules-doc');

      await assertSucceeds(ref.set({ ownerId: 'owner-a', title: 'Test', status: 'uploading' }));
      await assertSucceeds(ref.get());
      await assertSucceeds(ref.update({ status: 'ready' }));
      await assertSucceeds(ref.delete());
    });

    it('owner happy path: read and write the current Extraction', async () => {
      const owner = testEnv.authenticatedContext('seed-test-user', {
        email: 'test-user@test.com',
      });
      const db = owner.firestore();
      const ref = db.doc('users/seed-test-user/documents/rules-doc/extractions/current');

      await assertSucceeds(ref.set({ schemaVersion: 1 }));
      await assertSucceeds(ref.get());
    });

    it('non-owner is denied on another user’s Documents', async () => {
      const intruder = testEnv.authenticatedContext('owner-b', {
        email: INTEGRATION_OWNER_EMAIL,
      });
      const db = intruder.firestore();

      await assertFails(db.doc('users/owner-a/documents/any').get());
      await assertFails(
        db.doc('users/owner-a/documents/any').set({ ownerId: 'owner-b', title: 'x' }),
      );
    });

    it('create must pin ownerId to the owner', async () => {
      const owner = testEnv.authenticatedContext('owner-a', {
        email: INTEGRATION_OWNER_EMAIL,
      });

      await assertFails(
        owner.firestore().doc('users/owner-a/documents/any').set({ ownerId: 'someone-else' }),
      );
    });

    it('users outside the allowlist are denied even on their own subtree', async () => {
      const stranger = testEnv.authenticatedContext('stranger', {
        email: 'stranger@nowhere.dev',
      });
      const db = stranger.firestore();

      await assertFails(db.doc('users/stranger/documents/any').get());
      await assertFails(db.doc('users/stranger/documents/any').set({ ownerId: 'stranger' }));
    });
  });

  describe('storage.rules', () => {
    it('owner happy path: upload, read, and delete an own PDF', async () => {
      const owner = testEnv.authenticatedContext('owner-a', {
        email: INTEGRATION_OWNER_EMAIL,
      });
      const object = owner.storage().ref('users/owner-a/documents/rules.pdf');

      await assertSucceeds(put(object, new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf'));
      await assertSucceeds(object.getMetadata());
      await assertSucceeds(object.delete());
    });

    it('non-owner is denied on another user’s storage path', async () => {
      const intruder = testEnv.authenticatedContext('owner-b', {
        email: INTEGRATION_OWNER_EMAIL,
      });
      const object = intruder.storage().ref('users/owner-a/documents/x.pdf');

      await assertFails(put(object, new Uint8Array([1]), 'application/pdf'));
      await assertFails(object.getMetadata());
    });

    it('rejects uploads over 10 MB', async () => {
      const owner = testEnv.authenticatedContext('owner-a', {
        email: INTEGRATION_OWNER_EMAIL,
      });

      await assertFails(
        put(owner.storage().ref('users/owner-a/documents/too-big.pdf'), new Uint8Array(10 * 1024 * 1024 + 1), 'application/pdf'),
      );
    });

    it('rejects non-PDF content types', async () => {
      const owner = testEnv.authenticatedContext('owner-a', {
        email: INTEGRATION_OWNER_EMAIL,
      });

      await assertFails(
        put(owner.storage().ref('users/owner-a/documents/photo.png'), new Uint8Array([1]), 'image/png'),
      );
    });

    it('users outside the allowlist are denied even on their own path', async () => {
      const stranger = testEnv.authenticatedContext('stranger', {
        email: 'stranger@nowhere.dev',
      });

      await assertFails(
        put(stranger.storage().ref('users/stranger/documents/x.pdf'), new Uint8Array([1]), 'application/pdf'),
      );
    });
  });
});

/** The compat `put` returns a thenable `UploadTask`, not a full `Promise`. */
function put(
  object: StorageObject,
  data: Uint8Array,
  contentType: string,
): Promise<unknown> {
  return Promise.resolve(object.put(data, { contentType }));
}

type StorageObject = ReturnType<ReturnType<RulesTestContext['storage']>['ref']>;
