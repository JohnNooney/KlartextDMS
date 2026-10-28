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

  it('toggleInsightsLane hides and re-shows the Guest insights lane (#76)', async () => {
    const { open } = await setup();
    expect(open.insightsLaneHidden()).toBe(false);

    open.toggleInsightsLane();
    expect(open.insightsLaneHidden()).toBe(true);

    open.toggleInsightsLane();
    expect(open.insightsLaneHidden()).toBe(false);
  });

  it('the lane is shown for every opened Document — hidden is not remembered (#76)', async () => {
    const { open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    open.toggleInsightsLane();
    expect(open.insightsLaneHidden()).toBe(true);

    // Stepping to a sibling Document shows the lane again.
    open.open({ id: 'doc-2', folderId: null });
    expect(open.insightsLaneHidden()).toBe(false);

    // So does closing and reopening the same Document.
    open.toggleInsightsLane();
    open.close();
    await stable();
    open.open({ id: 'doc-1', folderId: null });
    expect(open.insightsLaneHidden()).toBe(false);
  });

  it('an unrecognized URL falls back to the library root', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/nowhere/at/all');
    expect(router.url).toBe('/folder/root');
    expect(open.docId()).toBeNull();
    expect(open.folderId()).toBeNull();
  });

  // Library search (issue #121): the query lives in the URL as ?q= so browser
  // back out of a result returns to the same results.

  it('search() writes the query as ?q= on the browsed Folder', async () => {
    const { router, open, stable } = await setup();
    await router.navigateByUrl('/folder/vertraege');
    open.search('deposit');
    await stable();
    expect(router.url).toBe('/folder/vertraege?q=deposit');
    expect(open.query()).toBe('deposit');
  });

  it('clearing the field drops the param again', async () => {
    const { router, open, stable } = await setup();
    open.search('deposit');
    await stable();
    open.search('   ');
    await stable();
    expect(router.url).toBe('/folder/root');
    expect(open.query()).toBeNull();
  });

  it('a ?q= deep link browses with the query already active', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/folder/kranken?q=kaution');
    expect(open.folderId()).toBe('kranken');
    expect(open.query()).toBe('kaution');
  });

  it('an unchanged query writes nothing — no dead history entry', async () => {
    const { router, open, stable } = await setup();
    const navigate = vi.spyOn(router, 'navigate');
    open.search('');
    await stable();
    expect(navigate).not.toHaveBeenCalled();
    expect(router.url).toBe('/folder/root');

    open.search('tax');
    await stable();
    navigate.mockClear();
    open.search('tax');
    await stable();
    // Still the single ?q= entry — no duplicate is stacked on top.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the scope pill widens into ?scope=all beside ?q=', async () => {
    const { router, open, stable } = await setup();
    open.search('tax');
    await stable();
    open.setSearchScope('all');
    await stable();
    expect(router.url).toBe('/folder/root?q=tax&scope=all');
    expect(open.searchScope()).toBe('all');
  });

  it('a ?q=&scope=all URL restores the widened search on the way back', async () => {
    const { open, location } = await setup();
    location.simulateUrlPop('/folder/root?q=tax&scope=all');
    await vi.waitFor(() => expect(open.query()).toBe('tax'));
    expect(open.searchScope()).toBe('all');
  });

  it('browser back onto a ?q= URL restores the query', async () => {
    const { router, open, location, stable } = await setup();
    open.search('deposit');
    await stable();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    expect(open.query()).toBeNull();

    location.simulateUrlPop('/folder/root?q=deposit');
    await vi.waitFor(() => expect(open.query()).toBe('deposit'));
    expect(router.url).toContain('q=deposit');
  });

  it('opening a Document or another Folder leaves the query behind', async () => {
    const { open, stable } = await setup();
    open.search('kaution');
    await stable();
    open.openFolder('wohnung');
    await stable();
    expect(open.query()).toBeNull();
  });

  it('search() is a no-op while a Document is open', async () => {
    const { router, open, stable } = await setup();
    open.open({ id: 'doc-1', folderId: null });
    await stable();
    open.search('sneaky');
    await stable();
    expect(router.url).toBe('/folder/root/doc/doc-1');
    expect(open.query()).toBeNull();
  });

  // Issue #122: Reminder exports deep-link back via the Folder-independent
  // `/doc/<id>` form — the Library resolves the Folder and rewrites the URL.

  it('a /doc/<id> deep link publishes the link awaiting Folder resolution', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/doc/doc-mietvertrag?page=3&item=ai_abc');
    expect(open.docId()).toBe('doc-mietvertrag');
    expect(open.deepLink()).toEqual({
      documentId: 'doc-mietvertrag',
      page: 3,
      item: 'ai_abc',
    });
  });

  it('a malformed ?page= deep-links with no page', async () => {
    const { router, open } = await setup();
    await router.navigateByUrl('/doc/doc-1?page=0&item=ai_1');
    expect(open.deepLink()).toEqual({ documentId: 'doc-1', page: null, item: 'ai_1' });
  });

  it('landDeepLink rewrites to the canonical Folder URL, keeping page and item', async () => {
    const { router, open, stable } = await setup();
    await router.navigateByUrl('/doc/doc-1?page=2&item=ai_1');
    open.landDeepLink({ id: 'doc-1', folderId: 'vertraege' }, open.deepLink()!);
    await stable();
    expect(router.url).toBe('/folder/vertraege/doc/doc-1?page=2&item=ai_1');
    // The rewrite consumed the marker — no second resolution fires.
    expect(open.deepLink()).toBeNull();
    expect(open.folderId()).toBe('vertraege');
  });

  it('a deep-linked Document that is missing falls back to the root Folder', async () => {
    const { router, open, stable } = await setup();
    await router.navigateByUrl('/doc/doc-ghost');
    expect(open.deepLink()?.documentId).toBe('doc-ghost');
    open.deepLinkMissed();
    await stable();
    expect(router.url).toBe('/folder/root');
    expect(open.docId()).toBeNull();
  });
});
