## Original brief (verbatim, as given at charting)

### Project Klartext: AI-Powered Expat Document Manager

**1. Problem Statement & Backstory**

The User Context: I recently relocated to Germany and have been overwhelmed by the sheer volume of complex German paperwork and contracts (Mietvertrag, Krankenversicherung, etc.). I need a secure, digital filing cabinet to store these documents. More importantly, I need an AI tool that can translate these documents and extract the "TL;DR" (Key Takeaways, Notice Periods, Hidden Fees) so I can easily understand what I am signing or storing.

The Technical Constraint (Microfrontend Simulation): This project also serves as a sandbox to simulate a specific enterprise architectural challenge: integrating a newly acquired Vue.js AI product into a legacy Angular dashboard using `iframes`. Therefore, the architecture must strictly separate the storage dashboard (Angular) and the AI extraction widget (Vue 3), communicating solely via a secure `Window.postMessage` event bus. Do not attempt to use Webpack Module Federation or Web Components; the iframe constraint is intentional.

**2. System Architecture**

The repository will contain two completely separate frontend applications running on different local ports.

App A: The Host (Legacy Filing Cabinet)
- Tech Stack: Angular (latest stable), SCSS.
- Role: The main dashboard and file repository.
- UI Requirements:
  - A left-hand sidebar listing uploaded documents (e.g., Mietvertrag.pdf, Internet.pdf).
  - A main content area. When no document is selected, show a welcome screen. When a document is selected, render an `<iframe>` pointing to App B, taking up the remaining screen real estate.
- Responsibilities: File selection, rendering the iframe, and passing authentication/document context into the iframe.

App B: The Guest (AI Extraction Widget)
- Tech Stack: Vue 3 (Composition API), Vite, TailwindCSS.
- Role: The AI-powered document viewer and data extractor.
- UI Requirements:
  - A split-screen view inside the iframe.
  - Left side: A placeholder document viewer (can just be a stylized box representing the PDF for now).
  - Right side: The AI results panel showing the English translation, a bulleted list of "Key Takeaways," and any "Critical Warnings."
- Responsibilities: Receiving context from the host, simulating an LLM API call, handling skeleton loading states, and displaying the parsed JSON.

**3. Cross-Frame Event Bus Contract (`Window.postMessage`)**

Communication between Angular and Vue must adhere to this strict event payload structure: `{ type: string, payload: any }`.

From Angular to Vue:
- `INIT_SESSION`: Sent when a document is clicked. Payload: `{ documentId: string, documentTitle: string, authToken: string }`

From Vue to Angular:
- `AI_PROCESSING_STARTED`: Sent when Vue begins the LLM call. Angular should use this to lock the sidebar (disable clicking other docs) so the user doesn't interrupt the process.
- `AI_PROCESSING_SUCCESS`: Sent when processing finishes. Angular unlocks the sidebar.
- `AI_PROCESSING_ERROR`: Sent if the extraction fails.

**4. AI / Backend Data Schema**

The Vue application will simulate a call to an LLM (or integrate directly with the OpenAI API). The AI must return data strictly adhering to this JSON schema:

```json
{
  "documentId": "123",
  "documentType": "Lease Agreement",
  "translatedSummary": "This is a standard residential lease agreement for an apartment...",
  "keyTakeaways": [
    "Monthly warm rent is €1,200.",
    "Deposit of €3,000 is required before move-in."
  ],
  "criticalWarnings": [
    "Cancellation requires a 3-month notice period.",
    "Tenant is responsible for minor cosmetic repairs up to €100."
  ]
}
```

**5. Development Phases for the AI Agent**

- Phase 1: Workspace Setup. Initialize a monorepo or two side-by-side directories: `/angular-host` and `/vue-guest`. Install the respective frameworks.
- Phase 2: UI Scaffolding. Build the static UI for both apps. The Angular app should have a hardcoded list of 3 documents. The Vue app should have a hardcoded right-panel displaying the JSON schema structure.
- Phase 3: The Iframe Bridge. Embed the Vue app inside the Angular app. Implement the `Window.postMessage` listeners in both apps. Prove they are connected by clicking a document in Angular and seeing the title update in the Vue app.
- Phase 4: State & Loading UX. Implement the mock LLM call (with a 3-second `setTimeout`) in the Vue app. Implement skeleton loaders in Vue, and ensure the `AI_PROCESSING_STARTED` event correctly disables the Angular sidebar during those 3 seconds.
- Phase 5: Styling Polish. Create a shared `theme.css` file with CSS Custom Properties (colors, fonts) and import it into both apps so the iframe feels like a seamless part of the Angular host.

---

**Charting amendments (settled in the charting session, supersede the brief where they conflict):** Firebase is the platform from the first cut (Hosting, Auth, Storage, Firestore, AI Logic; emulators locally). The LLM is Gemini via the Firebase AI Logic client SDK from the Guest, no proxy; the PDF goes to the multimodal model directly. `authToken` is a real Firebase Auth ID token. One Extraction per Document persisted in Firestore. npm/pnpm workspace. Playwright e2e + unit tests. Both apps deploy to Firebase Hosting as separate sites.
