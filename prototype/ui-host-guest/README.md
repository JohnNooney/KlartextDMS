# Klartext Host + Guest UI prototype

Throwaway prototype for Wayfinder ticket **Host and Guest UI prototype**.

## What this shows

A Drive/Files-style **Host** with:
- A file-tree sidebar with categories/folders.
- A file explorer grid (with an upload card).
- Selecting a file opens a split **reader**: raw PDF placeholder on the left, Guest iframe (smart insights panel) on the right.
- An upload dialog to add a new file; after 5 s a toast notification says processing is complete.
- If you open a file that is still processing, the Guest panel shows a loading skeleton.
- Mobile: the insights panel becomes a bottom sheet opened from the reader toolbar.

The **Guest** is a Vue 3 + Tailwind smart panel that only renders extraction states (idle, loading, success, error) and receives session/ status messages from the Host over `postMessage`.

Both apps share the light theme tokens in `shared/theme.css`.

## Run

```bash
cd prototype/ui-host-guest
npm install
npm run dev
```

Open `http://localhost:5173`.

## Interaction tips

1. Click a folder in the left sidebar to filter files.
2. Click a file card to open the split reader.
3. Click **Upload file** in the top-right, fill the dialog, and click **Upload**. A new card appears with “Processing…”; after ~5 s a toast notification appears.
4. Click the processing file to see the Guest loading skeleton; wait, then the toast appears and the Guest state can refresh (re-open the file).
5. On a narrow viewport, the insights panel hides; use the **Insights** button in the toolbar to open the bottom sheet.
