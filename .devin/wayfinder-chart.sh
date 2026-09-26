#!/usr/bin/env bash
# One-shot charting script for the Klartext wayfinder map. Idempotency is NOT
# guaranteed: run once. Prints "KEY=<number>" lines for each created issue.
set -euo pipefail
REPO="JohnNooney/KlartextDMS"

ensure_label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null; }
ensure_label wayfinder:map       5319E7 "Wayfinder map (index of decisions)"
ensure_label wayfinder:research  0E8A16 "Wayfinder ticket: AFK research"
ensure_label wayfinder:prototype FBCA04 "Wayfinder ticket: HITL prototype"
ensure_label wayfinder:grilling  1D76DB "Wayfinder ticket: HITL conversation"
ensure_label wayfinder:task      D93F0B "Wayfinder ticket: manual work unblocking a decision"

create() { # create <var> <label> <title> <body>
  local n; n=$(gh issue create --repo "$REPO" --label "$2" --title "$3" --body "$4" | sed -E 's#.*/([0-9]+)$#\1#')
  echo "$1=$n"; printf -v "$1" '%s' "$n"
}

create MAP wayfinder:map "Wayfinder map: Klartext handoff-ready spec" "$(cat <<'EOF'
## Destination

A handoff-ready spec for Klartext: every cross-cutting design decision resolved and recorded, plus a set of phased implementation issues an AFK agent can build from. Building the apps happens *after* this map, not on it.

## Notes

- Domain vocabulary lives in `CONTEXT.md` (Host, Guest, Document, Extraction, Bus, Envelope, Session). Use it in every ticket title and answer.
- Default skills per ticket: `grilling` + `domain-modeling`. Research tickets: `research`. Prototype tickets: `prototype`.
- **Standing constraints (from the original brief and charting):**
  - Host = Angular (latest stable) + SCSS. Guest = Vue 3 (Composition API) + Vite + TailwindCSS. Two separate apps on two ports; the Guest renders in an `<iframe>` in the Host.
  - Host and Guest communicate **only** via `window.postMessage` Envelopes `{ type, payload }`. No Module Federation, no Web Components: the iframe constraint is the point of the exercise.
  - Firebase is the platform for everything from the first cut: Hosting (both apps), Auth, Storage (Document bytes), Firestore (Document metadata + Extraction), Firebase AI Logic (Gemini). Local dev uses the Firebase emulators. There is **no** browser-local-only phase.
  - The AI call is **Gemini via the Firebase AI Logic client SDK from the Guest**, guarded by App Check + Auth. No Cloud Function proxy.
  - The PDF is sent to the multimodal model as-is; no client- or server-side text extraction.
  - One Extraction per Document, persisted in Firestore and reused on re-open; re-run only on explicit request.
  - `authToken` in the Session is a real Firebase Auth ID token, not a placeholder.
  - Repo is an npm/pnpm workspace with shared packages (at minimum theme tokens and the Bus contract types).
  - Testing target: Playwright e2e across the iframe + unit tests for Bus handlers in both apps.
  - Baseline Bus messages from the brief: Host→Guest `INIT_SESSION`; Guest→Host `AI_PROCESSING_STARTED` / `AI_PROCESSING_SUCCESS` / `AI_PROCESSING_ERROR`. Baseline Extraction schema: `documentId`, `documentType`, `translatedSummary`, `keyTakeaways[]`, `criticalWarnings[]`. Both are starting points the tickets may extend.
- The original project brief is posted as the first comment on this issue.

## Decisions so far

<!-- one line per closed ticket: [title](link): gist -->

## Not yet specified

- **Theme tokens.** The shared `theme.css` custom properties (palette, type scale, spacing, radii) and how Tailwind in the Guest consumes them. Sharpens after the UI prototype.
- **Document viewer.** The brief has a placeholder box; with real PDFs in Storage a real viewer (browser `<embed>`, pdf.js, or thumbnails) is cheap. Sharpens after storage and prototype.
- **Document lifecycle UX.** Upload flow, rename, delete, document types the user can tag, empty states. Sharpens after storage.
- **Extraction lifecycle UX.** Retry on error, explicit re-run, staleness when a Document is replaced, partial results. Sharpens after the Extraction schema and Bus contract.
- **Security rules & abuse limits.** Firestore/Storage rules, App Check enforcement mode, per-user Gemini quota or cost ceiling. Sharpens after auth and AI research.
- **Language handling.** Source-language detection (not all documents are German), target language fixed to English or user-selectable. Sharpens after the Extraction schema.
- **Non-PDF inputs.** Photos/scans of letters as images. Sharpens after the AI research says what Gemini accepts.

## Out of scope

- Module Federation, Web Components, or any non-iframe integration of the Guest: the iframe is the intentional constraint.
- Legal-advice accuracy guarantees for Extractions; this is a personal reading aid.
- Multi-user sharing of Documents; single signed-in owner only.
- Native mobile apps.
EOF
)"

# ---------- Frontier tickets (unblocked) ----------

create T1 wayfinder:grilling "Workspace layout and shared packages" "$(cat <<'EOF'
## Question

How is the repo laid out as a workspace, and what is shared between Host and Guest?

Decide: pnpm vs npm workspaces; directory layout (`apps/host`, `apps/guest`, `packages/*`); which shared packages exist (`theme` for CSS custom properties, `bus-contract` for Envelope/Session/Extraction TypeScript types, possibly `firebase-config`); how an Angular CLI app and a Vite app each consume a workspace package (path mapping vs built package); root scripts to run both apps plus the Firebase emulators with one command; Node version pinning.

Resolution is a recorded layout an implementation agent can scaffold from without further questions.
EOF
)"

create T2 wayfinder:research "Firebase AI Logic and Gemini for PDF Extractions" "$(cat <<'EOF'
## Question

What does Firebase AI Logic (client SDK, Gemini) actually support today for turning a PDF into a structured Extraction, and what are its limits?

Find from primary sources (Firebase docs, Gemini API docs, pricing pages):

- Which Gemini models accept PDF input via Firebase AI Logic; max pages / file size; inline bytes vs Cloud Storage for Firebase URL input, and any auth implications of the Storage-URL path.
- Structured output: is `responseSchema` / JSON mode available through the Firebase AI Logic web SDK, and what schema subset does it support (enums, arrays of strings, required fields)?
- Gemini Developer API vs Vertex AI Gemini API backends in Firebase AI Logic: differences in PDF support, region, pricing tier, and whether the Blaze plan is required.
- App Check: setup for a web app, support for `localhost` debug tokens, and whether AI Logic can be called from the emulator suite or always hits the real service.
- Indicative cost per Extraction for a 5-page German contract.
- Any restriction on calling AI Logic from inside a cross-origin iframe.

Capture findings as `docs/research/firebase-ai-logic-gemini-pdf.md` on branch `research/firebase-ai-logic`; link the file from the resolution comment.
EOF
)"

create T3 wayfinder:research "Cross-origin iframe on Firebase Hosting: security and Bus prerequisites" "$(cat <<'EOF'
## Question

What must be true of the Host's `<iframe>` and the Guest's hosting for a secure `postMessage` Bus when Host and Guest are separate Firebase Hosting sites (and separate `localhost` ports in dev)?

Find from primary sources (MDN, Firebase Hosting docs, Angular docs):

- Response headers the Guest must send so the Host can frame it (`Content-Security-Policy: frame-ancestors`, `X-Frame-Options` interplay) and how to set them in `firebase.json` for a specific Hosting site.
- `postMessage` origin discipline: exact `targetOrigin` on send, `event.origin` allow-listing on receive, and how the allow-list differs between emulator dev (`http://localhost:<port>`) and production (`https://<site>.web.app` and custom domains).
- Which `sandbox` / `allow` attributes the iframe needs for the Guest to use Firebase Auth popups/redirects, IndexedDB persistence, and network calls; what `sandbox` would break.
- Structured-clone transfer of a `Blob`/`ArrayBuffer` (a PDF) over `postMessage`: size practicality and `transfer` semantics.
- Angular specifics: safely binding a dynamic iframe `src` (`DomSanitizer` / `bypassSecurityTrustResourceUrl`), and running message listeners outside the zone where relevant.
- Firebase Hosting multi-site setup within one project (targets, deploy commands, preview channels).

Capture findings as `docs/research/cross-origin-iframe-bus.md` on branch `research/iframe-bus`; link the file from the resolution comment.
EOF
)"

create T4 wayfinder:research "Sharing a Firebase Auth session with a cross-origin Guest" "$(cat <<'EOF'
## Question

How can the Guest, running on a different origin than the Host, act as the same signed-in Firebase user so it can write Extractions to Firestore and call Firebase AI Logic under that user?

The Host owns sign-in. Firebase Auth persistence (IndexedDB) is per-origin, so the Guest cannot see the Host's session. Evaluate from primary sources (Firebase Auth docs, Firebase AI Logic docs):

- Whether an ID token forwarded over the Bus is usable by the Guest's Firebase SDK at all (it is not a sign-in credential) versus only as a bearer token for a backend.
- `signInWithCustomToken` in the Guest: requires a Cloud Function to mint a custom token from the Host's verified ID token; cost/latency and whether this reintroduces a backend we said we don't want.
- Having the Guest perform its own Firebase Auth sign-in (same project, same provider) with `authDomain` set so the popup/redirect works inside an iframe; how silent re-auth behaves cross-origin with third-party-cookie restrictions.
- Whether Firebase AI Logic requires Firebase Auth at all when App Check is enforced, i.e. could the Guest run anonymous auth and receive the user identity only as data for Firestore paths.
- Token refresh: ID tokens expire hourly; what the Bus must carry for the Guest to stay valid across a long Session.

Rank the options with trade-offs; the follow-up grilling ticket decides. Capture findings as `docs/research/auth-across-origins.md` on branch `research/auth-across-origins`; link the file from the resolution comment.
EOF
)"

create T5 wayfinder:task "Provision the Firebase project" "$(cat <<'EOF'
## Question

Nothing to decide: the deployment topology, auth, and AI tickets need a real Firebase project to inspect and test against.

Checklist for the human (HITL):

1. Create a Firebase project for Klartext (note the project id) and upgrade to the Blaze plan (required for Firebase AI Logic / Gemini).
2. Enable: Authentication (pick one provider for now; Google is fine), Cloud Firestore, Cloud Storage for Firebase, Firebase AI Logic, App Check, Hosting.
3. Register two web apps in the project: `klartext-host` and `klartext-guest`. Record both app configs.
4. Register both as App Check web apps (reCAPTCHA Enterprise or v3); generate debug tokens for localhost.
5. Install the Firebase CLI locally, `firebase login`, and confirm `firebase projects:list` shows the project.
6. Do **not** commit any config yet; record where the configs are kept.

Resolution comment records: project id, region, plan, enabled products, the two web app ids, App Check provider, and where the configs live. Later tickets treat these as facts.
EOF
)"

# ---------- Blocked tickets ----------

create T6 wayfinder:grilling "Bus contract v1" "$(cat <<'EOF'
## Question

What is the complete v1 Bus contract between Host and Guest?

Starting from the brief's four messages (`INIT_SESSION`, `AI_PROCESSING_STARTED`, `AI_PROCESSING_SUCCESS`, `AI_PROCESSING_ERROR`), decide:

- Handshake: does the Guest announce readiness (`GUEST_READY`) before the Host sends `INIT_SESSION`, or does the Host retry until acked?
- Envelope extensions: protocol version, correlation/request id, source tag; whether `payload` is typed per `type` as a discriminated union in the `bus-contract` package.
- Session payload: what identifies the Document to the Guest (id only, with the Guest fetching bytes from Storage under its own auth; or a download URL; or the bytes themselves) given the auth and storage research.
- Auth refresh: a message for a fresh token, or none if the Guest holds its own auth.
- Error payload shape and the Host's behaviour on each error class.
- What the Host does if the Guest never reports back (timeout, unlock the sidebar).
- Origin allow-list configuration for dev and prod.

Resolution is the contract written into the `bus-contract` package description with a sequence diagram for "user clicks a Document".
EOF
)"

create T7 wayfinder:grilling "Extraction schema and Gemini structured output" "$(cat <<'EOF'
## Question

What is the final Extraction schema, and how does the Guest get Gemini to emit exactly it?

Starting from the brief's schema (`documentId`, `documentType`, `translatedSummary`, `keyTakeaways[]`, `criticalWarnings[]`), decide:

- Whether `documentType` is free text or an enum (Mietvertrag, Krankenversicherung, Arbeitsvertrag, Internet/Telefon, Behördenbrief, Other).
- Whether each Key Takeaway / Critical Warning is a string or a small object (text, plus optional amount/date/reference to the original passage).
- Metadata to store alongside: model id, prompt version, created-at, source language detected, token counts for cost tracking.
- The `responseSchema` expressed in the subset Firebase AI Logic supports; prompt text and where it lives (shared package vs Guest); how the German original is preserved for the viewer.
- Validation: the Guest validates the response against the schema (zod or similar) before persisting and emitting `AI_PROCESSING_SUCCESS`; what happens on schema failure.

Resolution is the schema as a TypeScript type + JSON Schema, the prompt v1, and the Firestore document shape.
EOF
)"

create T8 wayfinder:grilling "Document storage and how the PDF reaches the Guest" "$(cat <<'EOF'
## Question

Where do Documents live, and how does the Guest get the bytes to show and to send to Gemini?

Decide:

- Storage layout: `users/{uid}/documents/{documentId}.pdf` in Cloud Storage; Firestore `users/{uid}/documents/{documentId}` for metadata and `.../extraction` for the Extraction (subcollection vs embedded field).
- Who uploads (Host) and who reads (Guest): does the Guest fetch via `getDownloadURL` / `getBytes` under its own auth, or does the Host push the bytes over the Bus? This must agree with the Bus contract.
- How the PDF is handed to Gemini: inline bytes from the Guest vs a Storage URL reference (per the AI research), and the size cap that implies for uploads.
- Repository interface in each app (`DocumentRepository`, `ExtractionRepository`) so emulator and prod are the same code with different config.
- Emulator suite configuration: which emulators, ports, seed data for the three demo Documents from the brief.

Resolution is the data model, the read/write ownership table (Host vs Guest per collection), and emulator config.
EOF
)"

create T9 wayfinder:grilling "Auth flow across Host and Guest" "$(cat <<'EOF'
## Question

Given the auth research, which mechanism makes the Guest act as the Host's signed-in user, and what does the sign-in UX look like?

Decide:

- The chosen option (Guest signs in itself via shared `authDomain`; custom-token mint; anonymous Guest + identity as data) and why the alternatives lost.
- Provider for v1 and whether email/password is needed for Playwright tests against the emulator.
- What the Host shows before sign-in; whether the iframe is mounted before or after the Guest is authenticated.
- Token lifecycle over the Bus if any token crosses it.
- Firestore/Storage rules sketch: owner-only read/write by `uid`.

Resolution is a sequence diagram from "open app" to "Guest has a valid user", and the rules sketch.
EOF
)"

create T10 wayfinder:grilling "Deployment topology and environments" "$(cat <<'EOF'
## Question

How are Host and Guest deployed on Firebase Hosting, and what environments exist?

Decide:

- Two Hosting sites in one project (`klartext-host`, `klartext-guest`) so the iframe is genuinely cross-origin in production; naming and custom domains if any.
- `firebase.json` shape: targets, per-site headers (`frame-ancestors` on the Guest), SPA rewrites for Angular and Vue.
- Environments: local emulators only + production, or also a preview channel per PR; how each app learns the other's origin per environment (build-time env vs runtime config).
- CI: what runs on push (lint, unit, Playwright against emulators) and what deploys.

Resolution is the topology diagram, `firebase.json` outline, and the env-config table.
EOF
)"

create T11 wayfinder:prototype "Host and Guest UI prototype" "$(cat <<'EOF'
## Question

What should the Host dashboard and the Guest split-screen look and behave like?

Build a throwaway, hardcoded prototype (no Firebase, no real Bus) to react to:

- Host: left sidebar with three Documents (Mietvertrag, Krankenversicherung, Internetvertrag), welcome screen when none is selected, iframe area when one is; locked-sidebar state while an Extraction runs.
- Guest: left placeholder viewer, right Extraction panel with translated summary, Key Takeaways list, Critical Warnings block; skeleton loading state; error state.
- Shared look: a first pass at the theme custom properties so the two feel like one product.

Resolution records what the human liked/rejected and the resulting UI decisions; links the prototype branch as an asset. This ticket graduates the "Theme tokens" and "Document viewer" fog if the prototype settles them.
EOF
)"

create T12 wayfinder:grilling "Testing spec" "$(cat <<'EOF'
## Question

How is Klartext tested, especially the Bus across the iframe?

Decide:

- Unit: Vitest for the Guest; Angular's default runner (or Vitest via the Angular builder) for the Host; how Bus handlers are tested in isolation with a fake `postMessage`.
- E2E: Playwright config that starts both dev servers and the Firebase emulators; frame locators to assert inside the Guest; seeding a test user and the three demo Documents; how Gemini is stubbed (route interception vs a fake AI client) so e2e is deterministic and free.
- Contract tests for the `bus-contract` package so Host and Guest cannot drift.
- What runs locally vs in CI.

Resolution is the test pyramid for this repo and the CI job list.
EOF
)"

create T13 wayfinder:grilling "Assemble the handoff spec and phased issues" "$(cat <<'EOF'
## Question

With every decision above closed, what is the final spec and how is the build sliced into issues an AFK agent can pick up?

Produce:

- `docs/spec.md` collecting the decisions (linking each ticket rather than restating it) in build order.
- ADRs for the hard-to-reverse choices that meet the domain-modeling bar (iframe-only integration; Firebase AI Logic with no proxy; Extraction persisted per Document).
- Phased implementation issues (re-cut from the brief's Phases 1-5 to fit the decisions), each labelled `ready-for-agent`, with acceptance criteria and blocking edges.

Resolution closes the map: the destination is reached when the phased issues exist.
EOF
)"

echo "DONE"
