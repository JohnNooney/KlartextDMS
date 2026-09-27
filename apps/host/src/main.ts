import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { HOST_CONFIG, type HostConfig } from './app/host-config';

// The Peer Origin for the Guest lives in a static config.json so the same build
// works in every Environment (ADR 0004); it must land before bootstrap.
const config = (await fetch('assets/config.json').then((r) => {
  if (!r.ok) throw new Error(`Failed to load assets/config.json: HTTP ${r.status}`);
  return r.json();
})) as HostConfig;

// Optional local overrides (gitignored): carries the App Check debug token in
// dev, written from the .env KLARTEXT_HOST_DEBUG_TOKEN by `pnpm start`. The
// trailing .catch covers both a missing file and the SPA rewrite answering
// index.html (HTTP 200, unparseable as JSON) where the file doesn't exist.
const localConfig = (await fetch('assets/config.local.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)) as Partial<HostConfig> | null;

Object.assign(config, localConfig);

bootstrapApplication(App, {
  ...appConfig,
  providers: [...appConfig.providers, { provide: HOST_CONFIG, useValue: config }],
}).catch((err) => console.error(err));
