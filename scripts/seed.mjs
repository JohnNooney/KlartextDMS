/**
 * Deterministic emulator seed (issues #9, #20, #22).
 *
 * Creates the demo Auth user, the prototype Folder tree, and the fixture
 * Documents — stored v2 and v1 (Outdated) Extractions, one without to exercise
 * first-time processing, and one recorded failure for Batch re-analysis
 * (issue #158). Ids are stable so the fake AI provider and e2e tests can key off
 * them; fixture Extractions in packages/bus-contract/src/fixtures/extractions.json
 * are what the Guest's fake provider returns (issue #30).
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
// Versicherungen → Krankenversicherung, Behörden. Behörden carries description
// and keywords so library search exercises Folder metadata matching (#121).
const FOLDERS = [
  { id: 'vertraege', name: 'Verträge', parentId: null },
  { id: 'wohnung', name: 'Wohnung', parentId: 'vertraege' },
  { id: 'internet', name: 'Internet & Mobilfunk', parentId: 'vertraege' },
  { id: 'versicherungen', name: 'Versicherungen', parentId: null },
  { id: 'kranken', name: 'Krankenversicherung', parentId: 'versicherungen' },
  {
    id: 'behoerden',
    name: 'Behörden',
    parentId: null,
    description: 'Letters from government offices',
    keywords: ['tax', 'amt'],
  },
];

// Fixture PDFs: regenerate with `node scripts/make-fixtures.mjs`.
const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

// The canonical copy lives in bus-contract — the Guest's fake provider imports
// it from the package; the seeder reads the same file so both stay in step.
const extractionFixtures = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../packages/bus-contract/src/fixtures/extractions.json', import.meta.url),
    ),
  ).toString('utf8'),
);

// `doc-versicherungsschein` is seeded as a stored schemaVersion 1 record so
// opening it exercises read-time normalization (ADR 0010); re-analyzing it
// upgrades it to v2 via the fake provider.
const legacyV1Fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../packages/bus-contract/src/fixtures/extractions-v1.json', import.meta.url),
    ),
  ).toString('utf8'),
);

// Fixture Documents spread across nested Folders and the root, matching
// the prototype library. `hasExtraction` controls whether a stored Extraction is
// seeded at documents/{id}/extractions/current; `fixtureFile` reuses another
// fixture's bytes, `legacyV1From` another Document's v1 Extraction.
const DOCUMENTS = [
  {
    id: 'doc-mietvertrag',
    title: 'Mietvertrag 2024',
    originalFilename: 'mietvertrag-2024.pdf',
    folderId: 'wohnung',
    hasExtraction: true,
    // Issue #144: the recurring rent item carries a Done mark whose
    // doneThrough is the *previous* occurrence — seeded already returned,
    // so e2e sees the recurrence roll back into "Needs your attention".
    actionItemStates: () => {
      const item = extractionFixtures['doc-mietvertrag'].actionItems.find(
        (i) => i.timing.kind === 'RECURRING',
      );
      // Previous occurrence: this month's day if already past, else last
      // month's. Correct for the seeded day (3 ≤ 28); the contract's
      // nextOccurrence handles short months differently.
      const previous = new Date();
      previous.setDate(item.timing.dayOfMonth);
      if (previous > new Date()) previous.setMonth(previous.getMonth() - 1);
      const iso = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`;
      return { [actionItemId(item)]: { doneAt: new Date().toISOString(), doneThrough: iso } };
    },
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
  // Batch re-analysis (issue #158, ADR 0015): more Outdated Extractions across
  // a parent Folder (Versicherungen) and its nested Folder (Krankenversicherung),
  // so "Outdated format" counts differ by scope. They reuse the TK fixture's
  // bytes and v1 Extraction, re-stamped; the fake provider answers unknown ids
  // with the golden v2 Extraction, so a batch run upgrades them.
  ...[
    { id: 'doc-haftpflicht', title: 'Haftpflichtversicherung', folderId: 'versicherungen' },
    { id: 'doc-hausrat', title: 'Hausratversicherung', folderId: 'versicherungen' },
    { id: 'doc-zahnzusatz', title: 'Zahnzusatzversicherung', folderId: 'kranken' },
  ].map((doc) => ({
    ...doc,
    originalFilename: `${doc.id.slice(4)}.pdf`,
    fixtureFile: 'versicherungsschein-tk.pdf',
    hasExtraction: true,
    legacyV1From: 'doc-versicherungsschein',
  })),
  // "Couldn't analyze": a recorded failure and no Extraction — never
  // auto-requeued on load, only re-run by the user.
  {
    id: 'doc-kuendigung',
    title: 'Kündigungsbestätigung Mobilfunk',
    originalFilename: 'kuendigung-mobilfunk.pdf',
    fixtureFile: 'brief-finanzamt.pdf',
    folderId: 'internet',
    hasExtraction: false,
    extractionFailure: {
      code: 'AI_UNAVAILABLE',
      message: 'The document assistant is not responding.',
      retryable: true,
    },
  },
];

// The Action Item id is a content hash computed in @klartext/bus-contract
// (`actionItemId`) — this mirrors it so the seeded Done mark keys match the
// ids both apps compute at read time.
function hashHex(input) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const actionItemId = (item) => `ai_${hashHex(`${item.sourceQuote}\u0000${item.timing.kind}`)}`;

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
    ...(folder.description ? { description: folder.description } : {}),
    ...(folder.keywords?.length ? { keywords: folder.keywords } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
await batch.commit();
console.log(`seeded ${FOLDERS.length} folders`);

for (const doc of DOCUMENTS) {
  const bytes = fixture(doc.fixtureFile ?? doc.originalFilename);
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
    ...(doc.actionItemStates ? { actionItemStates: doc.actionItemStates() } : {}),
    extractionFailure: doc.extractionFailure
      ? { ...doc.extractionFailure, failedAt: FieldValue.serverTimestamp() }
      : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (doc.hasExtraction) {
    const stored = doc.legacyV1From
      ? { ...legacyV1Fixtures[doc.legacyV1From], documentId: doc.id }
      : (legacyV1Fixtures[doc.id] ?? extractionFixtures[doc.id]);
    await db.doc(`users/${USER.uid}/documents/${doc.id}/extractions/current`).set({
      ...stored,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  console.log(`seeded document ${doc.id} (${doc.title})`);
}

console.log('seed complete');
