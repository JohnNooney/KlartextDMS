/**
 * Shared Firebase wiring for Host and Guest (issue #2).
 *
 * Scaffold shell: the web-app config (mirroring the committed `firebase.config`)
 * and the emulator endpoints so both apps connect to the same suite. App
 * initialization and emulator hookup land with the app shells (#25/#26): the
 * Host follows `useEmulators` from its `assets/config.json`, the Guest the
 * `VITE_USE_FIREBASE_EMULATORS` build-time flag (issues #9, #10).
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyBKkIAZy12xm06_qPCJhDLAz0BHN--6HWQ',
  authDomain: 'klartext-b836c.firebaseapp.com',
  projectId: 'klartext-b836c',
  storageBucket: 'klartext-b836c.firebasestorage.app',
  messagingSenderId: '680865987993',
  appId: '1:680865987993:web:cd0a552f35a96915fd6708',
  measurementId: 'G-W91BV8Z2SP',
} as const;

/** Emulator endpoints — ports per the emulator configuration in issue #9. */
export const emulatorConfig = {
  host: 'localhost',
  auth: { port: 9099 },
  firestore: { port: 8080 },
  storage: { port: 9199 },
} as const;
