---
status: accepted
---

# Overlay surface policy: one style per kind of surface, all modals Host-owned

Each overlay in Klartext uses the style its kind of surface calls for, chosen from a fixed table instead of being invented per feature (HIG Sheets, Modality, Action sheets). Every modal surface belongs to the Host. Under ADR 0006 the Guest renders inside an iframe and cannot cover the Host's page, so a modal the Guest needs is a Bus message to a Host-owned surface (as `GUEST_CREATE_REMINDER` already is). The Guest's only overlay is its in-frame ⋯ menu.

| Kind of surface | Phone (≤768px) | Desktop (≥769px) |
|---|---|---|
| Nonmodal supplementary panel (the Guest frame) | Bottom sheet without a backdrop: peek / half / full detents | Insights lane |
| Modal list (the attention "See All" sheet) | Modal sheet: medium + large detents, interactive grabber, swipe down to close, close (X) button | Centred card |
| Multi-step or multi-field task (the Reminder) | Full-screen modal | Centred dialog |
| Single-field form, picker, confirmation (rename, folder name, move, upload, delete) | Centred dialog / `alertdialog` | Centred dialog / `alertdialog` |
| Action menu (⋯, add) | Anchored popover that opens upwards when it would leave the viewport | Anchored popover |

Every modal surface traps focus, restores focus when it closes, and closes on Escape and a backdrop click. A surface with unsaved input asks "Discard changes?" before an implicit close (Escape, backdrop click, X). A sheet-closing button is never labelled "Done", because **Done** is an Action Item state and the attention sheet shows Action Items.

## Considered options

- **Every dialog becomes a sheet on phones.** Rejected: a full sheet is heavy for a single text field, and centred dialogs already stay above the iOS keyboard (DialogViewport, #64).
- **Every form goes full-screen on phones.** Rejected for the same reason. Only the Reminder needs it: it has several fields, and the native date picker has to stay anchored.
- **Menus become bottom action sheets on phones.** Rejected: the menus only open on an explicit tap, which HIG allows, and destructive items already go through a confirmation `alertdialog`, which covers the action sheet's safety benefit.
- **Done/Cancel header on the attention sheet.** Rejected: the sheet edits nothing, so Cancel has nothing to undo, and "Done" collides with the Action Item term.
