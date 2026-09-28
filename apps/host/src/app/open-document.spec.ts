import { Component } from '@angular/core';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { libraryUrl } from './app.routes';
import { OpenDocument } from './open-document';

@Component({ template: '' })
class Shell {}

const testRoutes = [
  { path: '', pathMatch: 'full' as const, redirectTo: 'folder/root' },
  { matcher: libraryUrl, component: Shell },
  { path: '**', redirectTo: 'folder/root' },
];

async function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter(testRoutes), provideLocationMocks()],
  });
  const router = TestBed.inject(Router);
  // Attaches the Router's popstate listener — bootstrap-only in production,
  // so TestBed must run it explicitly.
  router.initialNavigation();
  const open = TestBed.inject(OpenDocument);
  await router.navigateByUrl('/');
  return {
    router,
    open,
    location: TestBed.inject(Location) as SpyLocation,
    stable: () => TestBed.inject(ApplicationRef).whenStable(),
  };
}

describe('OpenDocument (issue #29 navigation seam)', () => {
  it('deep link /folder/<fid>/doc/<id> opens the Document inside its Folder', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/folder/wohnung/doc/doc-mietvertrag');
    expect(open.docId()).toBe('doc-mietvertrag');
    expect(open.folderId()).toBe('wohnung');
  });

  it('deep link under the root Folder maps the segment to null', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/folder/root/doc/doc-finanzamt');
    expect(open.docId()).toBe('doc-finanzamt');
    expect(open.folderId()).toBeNull();
  });

  it('a Folder deep link browses it with no Document open', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/folder/kranken');
    expect(open.folderId()).toBe('kranken');
    expect(open.docId()).toBeNull();
  });

  it('open() writes Folder + Document into the URL', async () => {
    const { router, open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: 'kranken' });
    expect(open.docId()).toBe('doc-1');
    await stable();
    expect(router.url).toBe('/folder/kranken/doc/doc-1');
  });

  it('open() for a root Document uses the root Folder segment', async () => {
    const { router, open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    expect(router.url).toBe('/folder/root/doc/doc-1');
  });

  it('close() returns to the parent Folder, keeping it in the URL', async () => {
    const { router, open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: 'wohnung' });
    await stable();
    open.close();
    expect(open.docId()).toBeNull();
    await stable();
    expect(router.url).toBe('/folder/wohnung');
    expect(open.folderId()).toBe('wohnung');
  });

  it('close() from a root Document returns to the library root', async () => {
    const { router, open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    open.close();
    await stable();
    expect(router.url).toBe('/folder/root');
    expect(open.docId()).toBeNull();
    expect(open.folderId()).toBeNull();
  });

  it('browser back/forward restores the view', async () => {
    const { open, location, stable } = await setup();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    open.close();
    await stable();

    // Popstate onto the Document's URL restores the reader…
    location.simulateUrlPop('/folder/root/doc/doc-1');
    await vi.waitFor(() => expect(open.docId()).toBe('doc-1'));

    // …and popstate back to the Folder closes it.
    location.simulateUrlPop('/folder/root');
    await vi.waitFor(() => expect(open.docId()).toBeNull());
  });

  it('an unrecognized URL falls back to the library root', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/nowhere/at/all');
    expect(router.url).toBe('/folder/root');
    expect(open.docId()).toBeNull();
    expect(open.folderId()).toBeNull();
  });
});
