---
status: accepted
---

# The Guest calls Gemini through the Firebase AI Logic client SDK; there is no backend proxy

The Guest invokes Gemini directly via the Firebase AI Logic web SDK, sending the Document's PDF bytes inline (`application/pdf`, ≤ 10 MB, comfortably under the SDK's 20 MB request cap). Structured output is enforced with `responseMimeType: "application/json"` plus a `responseSchema`. The project intentionally has **no** Cloud Function or other server-side proxy in front of the model: App Check attestation is the perimeter, and abuse is bounded by configuration — a ~10 RPM per-user AI Logic quota, a ~500 requests/day project quota override, and €5/€25 billing alerts (App Check and abuse-limits ticket).

## Considered options

- **Callable Cloud Function proxy.** Rejected: reintroduces a backend the project is deliberately exploring living without; it would have been required only for custom-token Guest auth or hard budget shutdown, both of which were traded away (auth flow and abuse-limits tickets).
- **`gs://` Storage references instead of inline bytes.** Rejected: requires the Vertex AI backend, gives the Guest a Storage access path to reason about, and buys nothing at the 10 MB document cap.
- **Gemini Developer API backend (Spark-free tier).** Initially rejected for no `gs://` support and no region selection — but `gs://` was already rejected above (inline bytes won) and the project has no EU-residency requirement recorded, so the free tier won out. **Revised: the Guest uses `GoogleAIBackend`.**
- ~~**Agent Platform (Vertex AI) Gemini API backend.**~~ **Revised: rejected** — requires `aiplatform.googleapis.com` enabled and bills on Blaze with no free tier; no feature it uniquely offers (`gs://`, region pinning, templates) is in use. Revisit if EU region pinning becomes a requirement.

## Consequences

- There is no AI Logic emulator: every real call hits Gemini. Tests and e2e use a deterministic fake provider (`VITE_FAKE_AI_PROVIDER`) implementing the same provider interface.
- The Guest needs App Check and an anonymous Auth sign-in before it can call the model; it needs nothing else — no Firestore/Storage access, no user credentials.
- The one repair attempt plus user-driven retry policy lives client-side; there is no server to absorb retries.
