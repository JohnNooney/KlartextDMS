---
status: accepted
---

# Two Hosting sites with per-PR preview channels; Peer Origins via referrer and runtime config

Host and Guest deploy as two Firebase Hosting sites in `klartext-b836c` — `klartext-host` and `klartext-guest` — so the iframe is genuinely cross-origin in production, which is the point of the exercise (see `docs/deployment.md` for the topology, `firebase.json` outline, and per-Environment config table). Every PR gets a preview channel on both sites, so the real cross-origin configuration is exercised before merge. Each app learns its Peer Origin differently: the Guest reads the Host's origin from `document.referrer` at runtime — free in every Environment including hashed preview URLs — while the Host reads the Guest's origin from a static `assets/config.json` fetched before bootstrap (committed per Environment; CI overwrites it with the captured Guest channel URL on previews). The Guest's `frame-ancestors` allows `https://*.web.app` and `http://localhost:*` alongside the exact production Host origins, because preview Host origins are unpredictable hashes and a wrongly-embedded Guest is inert — no Session, and the Bus's origin allow-list is the real boundary.

## Considered options

- **One site serving `host/` and `guest/` paths.** Rejected: same-origin, defeats the cross-origin constraint that motivates the project.
- **Build-time env files for the Guest origin.** Rejected: preview channel URLs carry a per-site random hash (`SITE--CHANNEL-HASH.web.app`) that cannot be baked into a build; a uniform runtime `config.json` covers all four Environments with one mechanism.
- **Guest `frame-ancestors` with exact origins only** (strict live config, CI-generated relaxed config for previews). Rejected: a second source of truth for little real protection in a personal app; the Bus allow-list carries the security load.
- **Pin both Hosting emulator ports explicitly.** Not possible: firebase-tools only exposes the first site's port; later sites auto-assign (~+5). Accepted as convention — Host first in the `firebase.json` array → :5050, Guest → :5055 (moved off the default :5000 in #34: macOS's AirPlay Receiver holds it) — with the emulator hub API (`localhost:4400/emulators`) as the escape hatch if assignment ever shifts.
- **Custom domains.** Rejected: `*.web.app` suffices for a personal project; revisitable later without changing the topology.

## Consequences

- Deploy order matters in preview: the Guest channel must deploy first so its URL can feed the Host's `config.json`.
- `document.referrer` must remain reliable: no `Referrer-Policy` stricter than `strict-origin-when-cross-origin` on the Host, and no `referrerpolicy` attribute stripping it on the iframe.
- Live and preview share one `firebase.json`, so the Guest's `frame-ancestors` wildcard is also on the live site; revisit if the Guest ever becomes sensitive to embedding.
- Playwright e2e runs against built output on the Hosting emulator, so headers and rewrites are genuinely tested — not just the dev servers.
