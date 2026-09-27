/**
 * Deterministic emulator seed (issues #9, #20, #22).
 *
 * Creates the demo Auth user, the prototype Folder tree, and three fixture
 * Documents — two with a stored Extraction, one without to exercise first-time
 * processing. Ids are stable so the fake AI provider and e2e tests can key off
 * them; fixture Extractions in ./fixtures/extractions.json are what the Guest's
 * fake provider returns.
 *
 * Run via `pnpm seed` (firebase emulators:exec … --export-on-exit), which
 * refreshes the committed `emulator-data/` snapshot that
 * `firebase emulators:start --import` loads.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Emulator ports come from firebase.json — the single source for the suite's
// wiring. Under `emulators:exec` the host vars are already set for the child
// process; standalone runs fall back to these.
const firebaseJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../firebase.json', import.meta.url)), 'utf8'),
);
process.env.FIRESTORE_EMULATOR_HOST ??= `localhost:${firebaseJson.emulators.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `localhost:${firebaseJson.emulators.auth.port}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `localhost:${firebaseJson.emulators.storage.port}`;

const PROJECT_ID = 'klartext-b836c';
const STORAGE_BUCKET = 'klartext-b836c.firebasestorage.app';

const USER = {
  uid: 'seed-test-user',
  email: 'test-user@test.com',
  password: 'test1234',
  displayName: 'Test User',
};

// Prototype Folder tree (issue #20): Verträge → {Wohnung, Internet & Mobilfunk},
// Versicherungen → Krankenversicherung, Behörden.
const FOLDERS = [
  { id: 'vertraege', name: 'Verträge', parentId: null },
  { id: 'wohnung', name: 'Wohnung', parentId: 'vertraege' },
  { id: 'internet', name: 'Internet & Mobilfunk', parentId: 'vertraege' },
  { id: 'versicherungen', name: 'Versicherungen', parentId: null },
  { id: 'kranken', name: 'Krankenversicherung', parentId: 'versicherungen' },
  { id: 'behoerden', name: 'Behörden', parentId: null },
];

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

const extractionFixtures = JSON.parse(fixture('extractions.json').toString('utf8'));

// Three fixture Documents spread across nested Folders and the root, matching
// the prototype library. `hasExtraction` controls whether a stored Extraction is
// seeded at documents/{id}/extractions/current.
const DOCUMENTS = [
  {
    id: 'doc-mietvertrag',
    title: 'Mietvertrag 2024',
    originalFilename: 'mietvertrag-2024.pdf',
    folderId: 'wohnung',
    hasExtraction: true,
  },
  {
    id: 'doc-versicherungsschein',
    title: 'Versicherungsschein TK',
    originalFilename: 'versicherungsschein-tk.pdf',
    folderId: 'kranken',
    hasExtraction: true,
  },
  {
    id: 'doc-finanzamt',
    title: 'Brief vom Finanzamt',
    originalFilename: 'brief-finanzamt.pdf',
    folderId: null,
    hasExtraction: false,
  },
];

const app = initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
const auth = getAuth(app);
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

try {
  await auth.getUser(USER.uid);
} catch {
  await auth.createUser(USER);
}
console.log(`seeded auth user ${USER.email} (${USER.uid})`);

const batch = db.batch();
for (const folder of FOLDERS) {
  batch.set(db.doc(`users/${USER.uid}/folders/${folder.id}`), {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    status: 'ready',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
await batch.commit();
console.log(`seeded ${FOLDERS.length} folders`);

for (const doc of DOCUMENTS) {
  const bytes = fixture(doc.originalFilename);
  const storagePath = `users/${USER.uid}/documents/${doc.id}.pdf`;
  await bucket.file(storagePath).save(bytes, { contentType: 'application/pdf' });
  await db.doc(`users/${USER.uid}/documents/${doc.id}`).set({
    id: doc.id,
    ownerId: USER.uid,
    title: doc.title,
    originalFilename: doc.originalFilename,
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    storagePath,
    status: 'ready',
    folderId: doc.folderId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (doc.hasExtraction) {
    await db.doc(`users/${USER.uid}/documents/${doc.id}/extractions/current`).set({
      ...extractionFixtures[doc.id],
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  console.log(`seeded document ${doc.id} (${doc.title})`);
}

console.log('seed complete');
