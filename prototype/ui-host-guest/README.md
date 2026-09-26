# Klartext Host + Guest UI prototype (THROWAWAY)

Decision aid for the Wayfinder ticket **Host and Guest UI prototype**. No Firebase, no real PDF rendering; data is hardcoded.

## Run

```bash
cd prototype/ui-host-guest
npm install
npm run dev        # Host http://localhost:5173, Guest http://localhost:5174
```

Open http://localhost:5173.

## What to evaluate

- **Host** (vanilla JS + SCSS stand-in for Angular): Files-style explorer with nested folders, folder tiles, Document tiles with a ⋮ menu, upload dialog (uploads start on drop), new-folder dialog, and toasts with a **View** action.
- **Split view**: the Host renders the PDF (placeholder pages); the **Guest** iframe is the smart insights panel (Vue 3 + Tailwind) built on Extraction schema v1.
- **Navigation variants** for the split view. Switch with the floating bar or `←`/`→`, or with `?nav=`:
  - **A · Breadcrumbs**: the sidebar stays and the breadcrumb path is the title (`Documents › Verträge › Wohnung › Mietvertrag 2024.pdf`).
  - **B · Focus + back**: the sidebar collapses; `‹ Wohnung` back button, a title with a path menu, and prev/next within the folder.
  - **C · Columns**: sidebar | Document list | split view; `✕` closes the Document.
- **Mobile (≤ 768px)**: always B-style push navigation and list rows; insights open in a bottom sheet (half height, tap the grabber for full).
- **Guest states**: use the floating bar to force Analyzing / Complete / Unreadable (a content status that can't be retried) / Error (retryable).
- **Show on page N** in the Guest sends a proposed `GUEST_SHOW_PAGE` Bus message; the Host scrolls to and highlights that page.

The URL holds `folder`, `file`, and `nav`, so browser back/forward and deep links work.
