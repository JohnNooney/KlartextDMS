---
status: accepted
---

# Folders form a client-side adjacency tree with recursive delete

Folders live in `users/{uid}/folders/{folderId}` with a nullable `parentId`; Documents point up via a nullable `folderId`. The Host fetches the whole `folders` collection and builds the tree in memory — a single user's library stays small enough that no stored ordering, materialized path, or denormalized count is needed. Depth is unlimited. Deleting a Folder is recursive: the Folder enters `deleting`, the Host cancels Extraction Jobs for every contained Document and tears each down bytes → Extraction → metadata (per Document storage and lifecycle UX), then removes child Folders and finally the Folder itself. Startup reconciliation re-runs any Folder still `deleting`, exactly as interrupted Document deletes are re-run.

## Considered options

- **Must-be-empty delete.** Rejected: tedious UX for a filing cabinet, and every mechanism recursive delete needs already existed from the Document lifecycle (`deleting` status, job cancellation, retryable teardown, startup reconcile).
- **Embedded tree in the user doc, or `children` subcollections per Folder.** Rejected: unbounded document / painful re-parenting and tree reads.
- **Depth cap.** Rejected: the tree and breadcrumb code already handle arbitrary depth; a cap is a UI concern addable later without a migration.

## Consequences

- Folder is stateful (`ready` / `deleting`) like Document, and folder tiles get the same ⋮ contract — Rename, Move to…, Delete — plus drag-to-tree and drop-onto-folder-tile. Moves reject self/descendant targets client-side.
- Sibling Folder names are unique (case-insensitive, trimmed); the check runs against the already-loaded tree.
- `description` and `keywords` are persisted on Folders with no v1 consumer; library search is recorded as fog on the wayfinder map.
