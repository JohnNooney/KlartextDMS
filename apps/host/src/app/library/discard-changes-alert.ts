import { Component, output } from '@angular/core';
import { ModalSurface } from './modal-surface';

/**
 * The "Discard changes?" alertdialog (issue #151, ADR 0014): a dirty modal
 * surface raises it on an implicit close — Escape, backdrop click, header X.
 * It stacks on the modal-alert rung, above the dialog that raised it.
 *
 * Implicit closes of the alert itself — Escape and its backdrop — always
 * pick Keep Editing: an accidental dismiss can never destroy input. An
 * explicit Discard tears down both surfaces; the dialogs' `closed` outputs
 * stay the single close signal.
 */
@Component({
  selector: 'app-discard-changes-alert',
  templateUrl: './discard-changes-alert.html',
  styleUrl: './dialogs.scss',
  imports: [ModalSurface],
})
export class DiscardChangesAlert {
  /** Keep Editing — return to the dialog with input intact. */
  readonly kept = output<void>();
  /** Discard — the dialog's unsaved input goes with it. */
  readonly discarded = output<void>();
}
