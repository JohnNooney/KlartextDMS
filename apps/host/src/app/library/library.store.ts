import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HostBus } from '../bus/host-bus';
import type { DocumentRecord } from '../data/document';
import { InvalidDocumentFileError } from '../data/document-input';
import { folderAncestry, type FolderRecord } from '../data/folder';
import type { NewFolder } from '../data/folder-repository';
import {
  buildFolderTree,
  canMoveFolder,
  compareNames,
  folderSubtree,
  siblingNameTaken,
  type FolderNode,
  type FolderTree,
} from '../data/folder-tree';
import { DOCUMENT_REPOSITORY, FOLDER_REPOSITORY } from '../data/providers';
import { UploadCancelledError, UploadPipeline, type UploadHandle } from '../data/upload-pipeline';
import { OpenDocument } from '../open-document';
import { ToastService } from '../toasts/toast.service';

/**
 * Runtime Extraction Job state (issues #31/#32): `queued`/`running` come from
 * the Bus, `failed` is set the moment the outcome arrives so the UI flips
 * straight to the retry affordance. Never persisted — `running` survives no
 * reload — and `failed` counts as handled for the auto-enqueue rule.
 */
export type ExtractionJobState = 'queued' | 'running' | 'failed';

/**
 * The Document library's state seam (issues #16, #28): owns the live document
 * feed, in-flight upload progress, the per-state tile actions, and the
 * delete/orchestration rules — cancel jobs, navigate back, toast. UI components
 * render its signals and call its methods; it owns no rendered DOM (the
 * download path mints a detached anchor to trigger the blob save).
 */
@Injectable()
export class LibraryStore {
  private readonly repository = inject(DOCUMENT_REPOSITORY);
  private readonly folderRepository = inject(FOLDER_REPOSITORY);
  private readonly pipeline = inject(UploadPipeline);
  private readonly toasts = inject(ToastService);
  private readonly bus = inject(HostBus);
  private readonly openDocument = inject(OpenDocument);

  /** The live library feed; `null` until the first snapshot lands. */
  readonly documents = signal<DocumentRecord[] | null>(null);
  /** The live Folder feed (issue #29); `null` until the first snapshot lands. */
  readonly folders = signal<FolderRecord[] | null>(null);
  /** Per-Document upload progress (0–1) while a task is in flight. */
  readonly progress = signal<ReadonlyMap<string, number>>(new Map());
  /** Folders whose recursive delete failed — the ⋮ menu offers **Retry delete** (#33). */
  readonly failedFolderDeletes = signal<ReadonlySet<string>>(new Set());
  /** Documents whose delete failed — the ⋮ menu offers **Retry delete**. */
  readonly failedDeletes = signal<ReadonlySet<string>>(new Set());
  /**
   * Per-Document runtime Extraction Job state (issue #32) — the tile chips and
   * the in-flight guards. Written by `ExtractionFlow`; never persisted.
   */
  readonly extractionJobs = signal<ReadonlyMap<string, ExtractionJobState>>(new Map());
  /** Documents holding a stored Extraction — no failure badge for these (#32). */
  readonly extractionStored = signal<ReadonlySet<string>>(new Set());
  /** The open Document record — only while the open id resolves to `ready`. */
  readonly openDoc = computed(() => {
    const doc = this.docById(this.openDocument.docId());
    return doc?.status === 'ready' ? doc : null;
  });
  /** The Documents filed in the Folder the URL browses (issue #29). */
  readonly visible = computed(() => {
    const folderId = this.openDocument.folderId();
    return this.documents()?.filter((d) => d.folderId === folderId) ?? null;
  });

  /** The Folder tree with sorted children and deep-count badges (ADR 0005). */
  readonly tree = computed<FolderTree>(() =>
    buildFolderTree(this.folders() ?? [], this.documents() ?? []),
  );
  /** The Folders directly inside the browsed Folder, name-sorted (#33). */
  readonly visibleFolders = computed(() =>
    (this.folders() ?? [])
      .filter((f) => f.parentId === this.openDocument.folderId())
      .sort((a, b) => compareNames(a.name, b.name)),
  );

  private reconciled = false;
  private foldersReconciled = false;

  constructor() {
    const unwatchDocuments = this.repository.watch((documents) => this.onSnapshot(documents));
    const unwatchFolders = this.folderRepository.watch((folders) => {
      this.folders.set(folders);
      this.reconcileFolders();
    });
    inject(DestroyRef).onDestroy(() => {
      unwatchDocuments();
      unwatchFolders();
    });
  }

  /** The Folder record behind an id, for labels and the path menu (#29). */
  folderById(folderId: string | null): FolderRecord | undefined {
    if (folderId === null) return undefined;
    return this.folders()?.find((f) => f.id === folderId);
  }

  /** Root-first ancestry for a Folder (path menu, ADR 0005 adjacency walk). */
  ancestryOf(folderId: string | null): FolderRecord[] {
    return folderAncestry(this.folders() ?? [], folderId);
  }

  /** A Folder's node in the tree — deep counts for badges and delete confirm. */
  folderNode(folderId: string): FolderNode | undefined {
    const find = (nodes: FolderNode[]): FolderNode | undefined => {
      for (const node of nodes) {
        if (node.folder.id === folderId) return node;
        const below = find(node.folders);
        if (below) return below;
      }
      return undefined;
    };
    return find(this.tree().folders);
  }

  /** Every Folder id a Folder can't move under: itself and its descendants. */
  moveBlockedIds(folderId: string): ReadonlySet<string> {
    return new Set(folderSubtree(this.folders() ?? [], [], folderId).folderIds);
  }

  /** A tile or tree row dropped on a Folder target (`null` = root). */
  async dropItem(item: { kind: 'folder' | 'document'; id: string }, targetId: string | null) {
    if (item.kind === 'folder') await this.moveFolder(item.id, targetId);
    else if (this.docById(item.id)?.folderId !== targetId) await this.move(item.id, targetId);
  }

  /** Whether a sibling Folder already uses `name` under `parentId` (case-insensitive). */
  nameTaken(parentId: string | null, name: string, excludeId?: string): boolean {
    return siblingNameTaken(this.folders() ?? [], parentId, name, excludeId);
  }

  /** ⋮ / sidebar New folder: `false` when refused (blank or duplicate sibling name). */
  async createFolder(
    input: Pick<NewFolder, 'name' | 'description' | 'keywords'>,
    parentId: string | null = this.openDocument.folderId(),
  ): Promise<boolean> {
    const name = input.name.trim();
    if (!name || this.nameTaken(parentId, name)) return false;
    try {
      await this.folderRepository.create({ ...input, name, parentId });
      return true;
    } catch {
      this.toasts.show({ tone: 'error', title: 'Couldn\'t create folder', body: 'Try again.' });
      return false;
    }
  }

  /** ⋮ → Rename on a Folder tile. */
  async renameFolder(folderId: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    const folder = this.folderById(folderId);
    if (!folder || !trimmed || this.nameTaken(folder.parentId, trimmed, folderId)) return false;
    if (trimmed === folder.name) return true;
    try {
      await this.folderRepository.update(folderId, { name: trimmed });
      return true;
    } catch {
      this.toasts.show({ tone: 'error', title: 'Rename failed', body: 'Try again.' });
      return false;
    }
  }

  /** Re-parents a Folder; self/descendant targets and name clashes are refused. */
  async moveFolder(folderId: string, targetId: string | null): Promise<boolean> {
    const folder = this.folderById(folderId);
    if (!folder) return false;
    if (folder.parentId === targetId) return true;
    if (
      !canMoveFolder(this.folders() ?? [], folderId, targetId) ||
      this.nameTaken(targetId, folder.name, folderId)
    ) {
      this.toasts.show({
        tone: 'error',
        title: 'Move failed',
        body: 'A folder can\'t move into itself or a folder that already has that name.',
      });
      return false;
    }
    try {
      await this.folderRepository.update(folderId, { parentId: targetId });
      return true;
    } catch {
      this.toasts.show({ tone: 'error', title: 'Move failed', body: 'Try again.' });
      return false;
    }
  }

  /**
   * The confirmed recursive Folder delete (ADR 0005): leave the tree if the
   * open Document or browsed Folder is inside it, mark the Folder `deleting`,
   * then tear everything down.
   */
  async deleteFolder(folderId: string): Promise<void> {
    const folder = this.folderById(folderId);
    if (!folder) return;
    const { folderIds } = folderSubtree(this.folders() ?? [], this.documents() ?? [], folderId);
    const openDocFolder = this.docById(this.openDocument.docId())?.folderId ?? null;
    if (this.openDocument.docId() !== null && openDocFolder !== null && folderIds.includes(openDocFolder)) {
      this.openDocument.close(folder.parentId);
    } else if (this.openDocument.folderId() !== null && folderIds.includes(this.openDocument.folderId()!)) {
      this.openDocument.openFolder(folder.parentId);
    }
    try {
      await this.folderRepository.update(folderId, { status: 'deleting' });
    } catch {
      this.toasts.show({ tone: 'error', title: `Couldn't delete ${folder.name}`, body: 'Try again.' });
      return;
    }
    await this.runFolderDelete(folderId, folder.name);
  }

  /** ⋮ → Retry delete on a Folder stuck in `deleting`. */
  async retryFolderDelete(folderId: string): Promise<void> {
    const folder = this.folderById(folderId);
    if (folder) await this.runFolderDelete(folderId, folder.name);
  }

  private async runFolderDelete(folderId: string, name: string, silent = false): Promise<void> {
    const { folderIds, documents } = folderSubtree(
      this.folders() ?? [],
      this.documents() ?? [],
      folderId,
    );
    try {
      for (const doc of documents) this.bus.cancelJobsFor(doc.id);
      for (const doc of documents) await this.pipeline.delete(doc.id);
      for (const id of folderIds) await this.folderRepository.delete(id);
      this.failedFolderDeletes.update((set) => without(set, folderId));
      if (!silent) this.toasts.show({ tone: 'success', title: `Deleted ${name}` });
    } catch {
      this.failedFolderDeletes.update((set) => new Set(set).add(folderId));
      this.toasts.show({ tone: 'error', title: `Couldn't delete ${name}`, body: 'Try again.' });
    }
  }

  /** Files picked in the upload dialog or dropped on the grid (#16). */
  uploadFiles(
    files: Iterable<File>,
    folderId: string | null = this.openDocument.folderId(),
  ): void {
    for (const file of files) void this.startUpload(file, folderId);
  }

  /** ⋮ → Cancel upload: aborts the task; metadata and partial bytes go too. */
  cancelUpload(documentId: string): void {
    this.pipeline.cancel(documentId);
  }

  /** Whether ⋮ → Retry upload is offered — the session holds the `File`. */
  canRetryUpload(documentId: string): boolean {
    return this.pipeline.fileFor(documentId) !== null;
  }

  /** ⋮ → Retry upload: re-sends the held File under the same `documentId`. */
  retryUpload(documentId: string): void {
    const file = this.pipeline.fileFor(documentId);
    if (file) void this.startRetry(documentId, file);
  }

  /** Drop-to-retry: a PDF dropped on a `failed` tile, same `documentId`. */
  retryWithFile(documentId: string, file: File): void {
    void this.startRetry(documentId, file);
  }

  /** ⋮ → Remove on a `failed` Document: metadata + partial bytes deleted. */
  async removeFailed(documentId: string): Promise<void> {
    await this.runDelete(documentId);
  }

  /** Rename (issue #16): non-empty after trim; `title` only. */
  async rename(documentId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await this.repository.rename(documentId, trimmed);
    } catch {
      this.toasts.show({ tone: 'error', title: 'Rename failed', body: 'Try again.' });
    }
  }

  /** ⋮ → Move to…: files the Document into `folderId` (`null` = root). */
  async move(documentId: string, folderId: string | null): Promise<void> {
    try {
      await this.repository.setFolder(documentId, folderId);
    } catch {
      this.toasts.show({ tone: 'error', title: 'Move failed', body: 'Try again.' });
    }
  }

  /** ⋮ → Download: `getBytes` → blob URL → anchor download (#16). */
  async download(documentId: string): Promise<void> {
    const doc = this.docById(documentId);
    try {
      const bytes = await this.repository.getBytes(documentId);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = doc?.originalFilename ?? 'document.pdf';
      anchor.click();
      // Defer the revoke — a synchronous revoke can cancel the save in Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.toasts.show({ tone: 'error', title: 'Download failed', body: doc?.title });
    }
  }

  /**
   * The confirmed delete path (issue #16): cancel queued/running Extraction
   * Jobs for the id, navigate back if the Document is open, then tear down
   * bytes → Extraction → metadata. A failed teardown leaves `deleting` and
   * offers **Retry delete**.
   */
  async confirmDelete(documentId: string): Promise<void> {
    if (this.openDocument.docId() === documentId) this.close();
    await this.delete(documentId);
  }

  /** ⋮ → Retry delete on a Document stuck in `deleting`. */
  async retryDelete(documentId: string): Promise<void> {
    await this.delete(documentId);
  }

  /** Opens a Document for reading — `ready` tiles only (issues #16, #29). */
  open(documentId: string): void {
    const doc = this.docById(documentId);
    if (doc?.status === 'ready') this.openDocument.open(doc);
  }

  close(): void {
    this.openDocument.close();
  }

  /** Records a Document's runtime Extraction Job state (chips, guards). */
  setExtractionJob(documentId: string, state: ExtractionJobState): void {
    this.extractionJobs.update((map) => new Map(map).set(documentId, state));
  }

  /** Clears a Document's runtime job state — its outcome is resolved. */
  clearExtractionJob(documentId: string): void {
    this.extractionJobs.update((map) => {
      if (!map.has(documentId)) return map;
      const next = new Map(map);
      next.delete(documentId);
      return next;
    });
  }

  /** Marks a Document as holding a stored Extraction (no failure badge). */
  markExtractionStored(documentId: string): void {
    this.extractionStored.update((set) =>
      set.has(documentId) ? set : new Set(set).add(documentId),
    );
  }

  private startUpload(file: File, folderId: string | null): Promise<void> {
    return this.start(file, () =>
      this.pipeline.upload(file, {
        folderId,
        onProgress: (id, fraction) => this.setProgress(id, fraction),
      }),
    );
  }

  private startRetry(documentId: string, file: File): Promise<void> {
    return this.start(file, () =>
      this.pipeline.retryUpload(documentId, file, {
        onProgress: (id, fraction) => this.setProgress(id, fraction),
      }),
    );
  }

  private async start(file: File, run: () => Promise<UploadHandle>): Promise<void> {
    try {
      this.track(await run(), file.name);
    } catch (err) {
      this.notifyUploadRejection(err, file.name);
    }
  }

  private track(handle: UploadHandle, filename: string): void {
    const documentId = handle.documentId;
    handle.completion.then(
      () => {
        this.clearProgress(documentId);
        this.toasts.show({ tone: 'success', title: `Uploaded ${filename}` });
      },
      (err: unknown) => {
        this.clearProgress(documentId);
        // Cancel is silent — the Document simply never existed (#16).
        if (!(err instanceof UploadCancelledError)) {
          this.toasts.show({ tone: 'error', title: 'Upload failed', body: filename });
        }
      },
    );
  }

  private notifyUploadRejection(err: unknown, filename: string): void {
    if (err instanceof InvalidDocumentFileError) {
      this.toasts.show({ tone: 'error', title: err.message, body: filename });
    } else {
      this.toasts.show({ tone: 'error', title: 'Upload failed', body: filename });
    }
  }

  /** Shared delete path: cancel the Document's jobs, then tear down (#16). */
  private async delete(documentId: string): Promise<void> {
    this.bus.cancelJobsFor(documentId);
    await this.runDelete(documentId);
  }

  private async runDelete(documentId: string, title?: string): Promise<void> {
    const label = title ?? this.docById(documentId)?.title ?? '';
    try {
      await this.pipeline.delete(documentId);
      this.failedDeletes.update((set) => without(set, documentId));
      if (label) this.toasts.show({ tone: 'success', title: `Deleted ${label}` });
    } catch {
      this.failedDeletes.update((set) => new Set(set).add(documentId));
      this.toasts.show({ tone: 'error', title: `Couldn't delete ${label}`, body: 'Try again.' });
    }
  }

  private onSnapshot(documents: DocumentRecord[]): void {
    this.documents.set(documents);
    // The open Document vanished or left `ready` — navigate back (#16).
    const openId = this.openDocument.docId();
    if (openId !== null && !documents.some((d) => d.id === openId && d.status === 'ready')) {
      this.close();
    }
    if (!this.reconciled) {
      this.reconciled = true;
      void this.reconcile(documents);
    }
    this.reconcileFolders();
  }

  /**
   * Startup reconciliation for Folders (ADR 0005): once both feeds have
   * landed, any Folder still `deleting` re-runs its recursive delete.
   */
  private reconcileFolders(): void {
    const folders = this.folders();
    if (this.foldersReconciled || folders === null || this.documents() === null) return;
    this.foldersReconciled = true;
    for (const folder of folders) {
      if (folder.status === 'deleting') void this.runFolderDelete(folder.id, folder.name, true);
    }
  }

  /**
   * Startup reconciliation (issue #16): orphaned `uploading` → `failed`;
   * `deleting` re-runs. A teardown that still fails stays `deleting` and is
   * offered as **Retry delete**.
   */
  private async reconcile(documents: DocumentRecord[]): Promise<void> {
    try {
      await this.pipeline.reconcile(documents);
    } catch {
      // Individual failures surface below via the still-deleting residue.
    }
    const stuck = (this.documents() ?? [])
      .filter((d) => d.status === 'deleting')
      .map((d) => d.id);
    if (stuck.length > 0) {
      this.failedDeletes.update((set) => new Set([...set, ...stuck]));
    }
  }

  private docById(documentId: string | null): DocumentRecord | undefined {
    if (documentId === null) return undefined;
    return this.documents()?.find((d) => d.id === documentId);
  }

  private setProgress(documentId: string, fraction: number): void {
    this.progress.update((map) => new Map(map).set(documentId, fraction));
  }

  private clearProgress(documentId: string): void {
    this.progress.update((map) => {
      if (!map.has(documentId)) return map;
      const next = new Map(map);
      next.delete(documentId);
      return next;
    });
  }
}

function without(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}
