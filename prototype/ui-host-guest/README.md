# Klartext Host + Guest UI prototype

Throwaway prototype for Wayfinder ticket **Host and Guest UI prototype**.

## What this shows

- **Host** (`http://localhost:5173`): Angular-ish SCSS sidebar with three hardcoded Documents, a welcome screen, and an iframe that loads the Guest. The sidebar locks during a simulated extraction run.
- **Guest** (`http://localhost:5174`): Vue 3 + Tailwind split-screen with a PDF placeholder on the left and an Extraction panel on the right. The panel cycles through idle / loading / success / error states.
- **Shared theme tokens** in `shared/theme.css` drive both apps so they feel like one product.

## Run

```bash
cd prototype/ui-host-guest
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Interaction tips

1. Click a Document in the Host sidebar.
2. Click **Simulate extraction run** in the Host footer.
3. Watch the Guest switch from loading skeleton to success (after 4 s) while the Host sidebar stays locked.
4. Use the Guest footer buttons to force states directly.
