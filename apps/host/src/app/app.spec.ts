import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@klartext/bus-contract';
import type { HostAdapter } from '@klartext/bus-contract/conformance';
import { App } from './app';
import { routes } from './app.routes';
import { AuthService } from './auth.service';
import { HOST_BUS_ADAPTER_FACTORY, type HostBusContext } from './bus/host-bus.adapter';
import { HostBusEvents } from './bus/host-bus-events';
import type { DocumentRepository } from './data/document-repository';
import type { FolderRepository } from './data/folder-repository';
import { DOCUMENT_REPOSITORY, FOLDER_REPOSITORY } from './data/providers';
import { UploadPipeline } from './data/upload-pipeline';
import { HOST_CONFIG } from './host-config';
import { Library } from './library/library';
import { LibraryStore } from './library/library.store';
import { OpenDocument } from './open-document';

const USER: SessionUser = { uid: 'u1', displayName: 'Test User', email: 'test-user@test.com' };

class FakeAuth {
  readonly user = signal<SessionUser | null | undefined>(undefined);
  readonly error = signal<string | null>(null);
  signInWithGoogle = vi.fn(async () => this.user.set(USER));
  signInWithEmail = vi.fn(async () => this.user.set(USER));
  signOut = vi.fn(async () => this.user.set(null));
}

const eventsSpy: HostBusEvents = {
  onGuestReady: vi.fn(),
  sessionFailed: vi.fn(),
  jobSucceeded: vi.fn(),
  jobFailed: vi.fn(),
};

// Library's scoped data providers hit Firebase — swap them for fakes; the
// store itself stays real so the shell still exercises the live-listener path.
const fakeRepository = {
  watch: vi.fn((emit: (docs: never[]) => void) => {
    emit([]);
    return () => {};
  }),
} as unknown as DocumentRepository;

const fakeFolderRepository = {
  watch: vi.fn((emit: (folders: never[]) => void) => {
    emit([]);
    return () => {};
  }),
} as unknown as FolderRepository;

const fakePipeline = {
  upload: vi.fn(),
  retryUpload: vi.fn(),
  cancel: vi.fn(),
  fileFor: vi.fn(() => null),
  delete: vi.fn(),
  reconcile: vi.fn(async () => {}),
} as unknown as UploadPipeline;

async function setup(options: { useEmulators?: boolean } = {}) {
  const auth = new FakeAuth();
  const contexts: HostBusContext[] = [];
  const adapter: HostAdapter = {
    openSession: vi.fn(),
    requestExtraction: vi.fn(),
    cancelJobs: vi.fn(),
    dispose: vi.fn(),
  };
  TestBed.overrideComponent(Library, {
    set: {
      providers: [
        { provide: DOCUMENT_REPOSITORY, useValue: fakeRepository },
        { provide: FOLDER_REPOSITORY, useValue: fakeFolderRepository },
        { provide: UploadPipeline, useValue: fakePipeline },
        LibraryStore,
      ],
    },
  });
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      {
        provide: HOST_CONFIG,
        useValue: {
          guestOrigin: 'http://localhost:5173',
          useEmulators: options.useEmulators ?? true,
        },
      },
      provideRouter(routes),
      { provide: AuthService, useValue: auth },
      { provide: HostBusEvents, useValue: eventsSpy },
      {
        provide: HOST_BUS_ADAPTER_FACTORY,
        useValue: (ctx: HostBusContext) => {
          contexts.push(ctx);
          return adapter;
        },
      },
    ],
  }).compileComponents();
  // Bootstrap-only in production — TestBed must kick the initial navigation.
  TestBed.inject(Router).initialNavigation();
  const fixture = TestBed.createComponent(App);
  return { fixture, auth, adapter, contexts };
}

describe('App', () => {
  it('shows a spinner until the first auth emission — no gate, no iframe', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(undefined);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')).toBeTruthy();
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('app-sign-in-gate')).toBeNull();
  });

  it('shows the sign-in gate when signed out', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-sign-in-gate')).toBeTruthy();
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('mounts the shell with a hidden Guest iframe after sign-in', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(USER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const iframe = el.querySelector('iframe');
    expect(el.querySelector('.sidebar')).toBeTruthy();
    expect(el.querySelector('.content')).toBeTruthy();
    expect(iframe).toBeTruthy();
    expect(iframe!.src).toContain('http://localhost:5173');
    expect(iframe!.closest('[hidden]')).toBeTruthy();
  });

  it('mounts the Document library inside the content region', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(USER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.content app-library')).toBeTruthy();
    expect(el.querySelector('app-toast-outlet')).toBeTruthy();
  });

  it('displays the Guest iframe while a Document is open, hidden otherwise', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(USER);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const host = el.querySelector('.guest-frame-host') as HTMLElement;
    expect(host.hidden).toBe(true);

    const openDoc = TestBed.inject(OpenDocument);
    openDoc.open({ id: 'doc-1', folderId: null });
    fixture.detectChanges();
    expect(host.hidden).toBe(false);
    expect(el.querySelector('iframe')).toBeTruthy();

    openDoc.close();
    fixture.detectChanges();
    expect(host.hidden).toBe(true);
  });

  it('keeps the iframe mounted while signed in and unmounts it on sign-out', async () => {
    const { fixture, auth, adapter } = await setup();
    auth.user.set(USER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('iframe')).toBeTruthy();

    await auth.signOut();
    fixture.detectChanges();
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('app-sign-in-gate')).toBeTruthy();
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it('binds the Bus adapter to window, the iframe window, and the Peer Origin', async () => {
    const { fixture, auth, contexts } = await setup();
    auth.user.set(USER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(contexts).toHaveLength(1);
    const [ctx] = contexts;
    expect(ctx!.peerOrigin).toBe('http://localhost:5173');
    expect(ctx!.sink).toBe(iframe.contentWindow);

    // The source is the Host window: a dispatched message event reaches it.
    const listener = vi.fn();
    ctx!.source.addEventListener('message', listener);
    window.dispatchEvent(new MessageEvent('message', { data: 'x', origin: 'http://x' }));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('shows the Email/Password form only under useEmulators', async () => {
    const { fixture, auth } = await setup({ useEmulators: true });
    auth.user.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="email"]')).toBeTruthy();
    expect(el.querySelector('input[type="password"]')).toBeTruthy();
  });

  it('hides the Email/Password form without useEmulators, keeping Google', async () => {
    const { fixture, auth } = await setup({ useEmulators: false });
    auth.user.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="email"]')).toBeNull();
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes('Google'))).toBe(true);
  });

  it('submits the emulator email sign-in with the typed credentials', async () => {
    const { fixture, auth } = await setup({ useEmulators: true });
    auth.user.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const email = el.querySelector('input[type="email"]') as HTMLInputElement;
    const password = el.querySelector('input[type="password"]') as HTMLInputElement;
    email.value = 'test-user@test.com';
    password.value = 'test1234';
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(auth.signInWithEmail).toHaveBeenCalledWith('test-user@test.com', 'test1234');
  });

  it('signs in with Google from the gate', async () => {
    const { fixture, auth } = await setup({ useEmulators: false });
    auth.user.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Google'),
    )!;
    button.click();
    await fixture.whenStable();
    expect(auth.signInWithGoogle).toHaveBeenCalled();
    fixture.detectChanges();
    expect(el.querySelector('iframe')).toBeTruthy();
  });

  it('shows the sign-in error on the gate', async () => {
    const { fixture, auth } = await setup();
    auth.user.set(null);
    auth.error.set('Sign-in did not complete. Try again.');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Sign-in did not complete',
    );
  });
});
