import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

/** The toast stack — fixed top-right, frosted per the theme (issue #28). */
@Component({
  selector: 'app-toast-outlet',
  templateUrl: './toast-outlet.html',
  styleUrl: './toast-outlet.scss',
})
export class ToastOutlet {
  protected readonly toasts = inject(ToastService);
}
