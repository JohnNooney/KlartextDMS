/**
 * Emulator harness for the Host's integration specs (issue #27).
 *
 * Builds one Firebase app wired to the running emulator suite (the same
 * wiring `provideKlartextFirebase` performs under `useEmulators`) and signs
 * in as the owner. Repositories under test receive these instances through
 * their constructors — production code, emulator run (issue #9).
 *
 * Test-only: never imported from application code.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { emulatorConfig, firebaseConfig } from '@klartext/firebase-config';

/**
 * The owner's Google email from the committed rules allowlist — the harness
 * signs in under it (at any uid, which the rules admit) so every suite runs in
 * a subtree the seeded demo user never touches. Keep in step with
 * `firestore.rules`/`storage.rules`.
 */
export const INTEGRATION_OWNER_EMAIL = 'johnnoon74@gmail.com';

export interface EmulatorHost {
  firestore: Firestore;
  storage: FirebaseStorage;
  /** The signed-in owner's uid — the `users/{uid}` the repositories scope to. */
  uid: string;
}

let instance: Promise<EmulatorHost> | undefined;

export function emulatorHost(): Promise<EmulatorHost> {
  instance ??= connect();
  return instance;
}

async function connect(): Promise<EmulatorHost> {
  const app: FirebaseApp = initializeApp(firebaseConfig, 'host-integration');
  const auth: Auth = getAuth(app);
  connectAuthEmulator(
    auth,
    `http://${emulatorConfig.host}:${emulatorConfig.auth.port}`,
    { disableWarnings: true },
  );
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, emulatorConfig.host, emulatorConfig.firestore.port);
  const storage = getStorage(app);
  connectStorageEmulator(storage, emulatorConfig.host, emulatorConfig.storage.port);

  // Fresh emulator boot: create the owner; already-warm boot (re-runs against
  // one long-lived emulator): sign back in. Either way the uid is stable for
  // the suite's lifetime.
  const password = 'integration-tests';
  try {
    await createUserWithEmailAndPassword(auth, INTEGRATION_OWNER_EMAIL, password);
  } catch {
    await signInWithEmailAndPassword(auth, INTEGRATION_OWNER_EMAIL, password);
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('integration owner sign-in failed');

  return { firestore, storage, uid };
}
