# Documentation

Klartext's documentation is organized around the [Diátaxis framework](https://diataxis.fr/start-here/), separating material by what you are trying to do:

| Quadrant | Purpose | Where to Go |
|---|---|---|
| **Tutorial** *(learning by doing)* | Run Klartext locally with seeded German documents and explore the UI in five minutes | [README — Try it yourself](../README.md#try-it-yourself) |
| **How-To Guides** *(solving specific tasks)* | Run & debug Playwright E2E tests, wire App Check debug tokens, or configure Cloud Console / CORS | [Development internals](./development.md) · [Deployment operations](./deployment.md) |
| **Explanation** *(understanding the big picture)* | Understand the microfrontend split, Bus data plane, document flows, security model, and CI/CD design | [Architecture — Part I: Explanation](./architecture.md#part-i-explanation--how-klartext-works) · [ADRs 0001–0008](./adr/) |
| **Reference** *(exact technical facts)* | Look up Bus message schemas, timeouts, Firestore paths, CSP headers, and source file locations | [Architecture — Part II: Reference](./architecture.md#part-ii-reference--technical-lookup) · [Domain Glossary (`CONTEXT.md`)](../CONTEXT.md) · [Handoff Spec](./spec.md) |
