import { inject, InjectionToken, type Provider } from '@angular/core';
import { AuthService } from '../auth.service';
import { FIREBASE_FIRESTORE, FIREBASE_STORAGE } from '../firebase';
import { LibraryStore } from '../library/library.store';
import { FirestoreDocumentRepository, type DocumentRepository } from './document-repository';
import { UploadPipeline } from './upload-pipeline';

/** The signed-in owner's Document persistence — Host-only (ADR 0001). */
export const DOCUMENT_REPOSITORY = new InjectionToken<DocumentRepository>(
  'DOCUMENT_REPOSITORY',
);

/**
 * The Host's document data layer for one signed-in session (issue #28).
 * Scoped below the sign-in gate (on the library component's providers) so a
 * fresh sign-in rebuilds repositories against the new uid.
 */
export function provideDocumentData(): Provider[] {
  return [
    {
      provide: DOCUMENT_REPOSITORY,
      useFactory: () => {
        const user = inject(AuthService).user();
        if (!user) throw new Error('DOCUMENT_REPOSITORY requires a signed-in user');
        return new FirestoreDocumentRepository(
          inject(FIREBASE_FIRESTORE),
          inject(FIREBASE_STORAGE),
          user.uid,
        );
      },
    },
    { provide: UploadPipeline, useFactory: () => new UploadPipeline(inject(DOCUMENT_REPOSITORY)) },
    LibraryStore,
  ];
}
