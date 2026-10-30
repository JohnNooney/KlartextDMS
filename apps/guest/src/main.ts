import { signInAnonymously } from 'firebase/auth';
import { createApp } from 'vue';
import App from './App.vue';
import { createGuestBusAdapter } from './bus/guest-bus.adapter';
import { windowBusSource } from './bus/window-bus';
import { createExtractionJobRunner } from './extraction/run-extraction-job';
import { initGuestFirebase, signInThenReady } from './firebase';
import { loadGuestConfig, referrerPeerOrigin } from './guest-config';
import {
  doneSender,
  expandPanelSender,
  loadFixtureSession,
  reminderSender,
  retrySender,
  sessionProbe,
  showPageSender,
} from './session-store';
import './style.css';

// Guest bootstrap (issue #26): Firebase + App Check first, then the panel.
const config = loadGuestConfig(import.meta.env);
const { app, auth } = initGuestFirebase(config);
createApp(App).mount('#app');

// The Peer Origin comes from document.referrer — no config file; works on
// hashed preview channel URLs (ADR 0004). Standalone dev is top-level
// (`window.parent === window`), not just a missing referrer: an embedded
// Guest whose referrer was stripped must never show fixture data — it stays
// unready and the Host's watchdog surfaces it.
const peerOrigin = referrerPeerOrigin(document.referrer);
if (window.parent === window) {
  loadFixtureSession();
} else if (peerOrigin === null) {
  console.error('[guest] embedded without a usable referrer — cannot address the Host');
} else {
  const adapter = createGuestBusAdapter({
    source: windowBusSource(window),
    sink: window.parent,
    peerOrigin,
    probe: sessionProbe,
    runJob: createExtractionJobRunner(config, app),
  });
  // The panel's Analyze/Re-analyze/Try-again actions send RETRY_EXTRACTION;
  // a selected takeaway row sends GUEST_SHOW_PAGE (issue #78); a jump-bar
  // tap sends GUEST_EXPAND_PANEL (issue #79); an Action Item's "Add
  // reminder" sends GUEST_CREATE_REMINDER (issue #122).
  retrySender.value = (documentId) => adapter.requestRetry(documentId);
  showPageSender.value = (request) => adapter.showPage(request);
  expandPanelSender.value = () => adapter.expandPanel();
  reminderSender.value = (actionItemId) => adapter.createReminder(actionItemId);
  doneSender.value = (actionItemId, done) => adapter.setActionItemDone(actionItemId, done);
  // GUEST_READY goes out only once anonymous sign-in resolves (issue #10).
  void signInThenReady(() => signInAnonymously(auth), adapter);
}
