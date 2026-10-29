import { Component, computed, input, OnInit, output, signal } from '@angular/core';
import { nextOccurrence, type ActionTiming } from '@klartext/bus-contract';
import { DiscardChangesAlert } from '../library/discard-changes-alert';
import { ModalSurface } from '../library/modal-surface';
import {
  buildIcs,
  cleanRrule,
  googleCalendarUrl,
  isCleanCadence,
  isPast,
  reminderDeepLink,
  reminderDescription,
  reminderTitle,
  reminderUid,
  subtractNotice,
  todayIso,
  type ReminderEvent,
} from './reminder';
import type { ReminderDraft } from './reminders';

const NOTICE_UNITS = { DAYS: 'day', WEEKS: 'week', MONTHS: 'month', YEARS: 'year' } as const;

/** The VALARM offset the picker opens on (issue #104). */
const DEFAULT_ALARM_DAYS = 7;

/** The VALARM offsets the picker offers (issue #104) — `null` is "none". */
const ALARM_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'No reminder' },
  { days: 1, label: '1 day before' },
  { days: 7, label: '7 days before' },
  { days: 30, label: '30 days before' },
];

/**
 * The Reminder dialog (issue #122): the single confirm-and-export surface
 * every "Add reminder" entry point lands on — the Guest's Bus request and
 * the Folder attention overview's own rows alike. The timing kind drives
 * the fields: FIXED_DATE pins the deadline and picks the alarm offset;
 * RECURRING confirms a first date (RRULE for clean cadences, cadence text
 * in the body otherwise); NOTICE_PERIOD asks the anchor and edits the
 * computed "must be received by"; NONE is a free date picker. A dirty
 * draft asks "Discard changes?" before an implicit close (issue #151).
 */
@Component({
  selector: 'app-reminder-dialog',
  templateUrl: './reminder-dialog.html',
  styleUrl: '../library/dialogs.scss',
  imports: [DiscardChangesAlert, ModalSurface],
})
export class ReminderDialog implements OnInit {
  readonly draft = input.required<ReminderDraft>();
  readonly closed = output<void>();

  protected readonly alarmOptions = ALARM_OPTIONS;

  /** The event date (FIXED_DATE, clean RECURRING's first, NONE's pick). */
  protected readonly date = signal('');
  /** The NOTICE_PERIOD anchor the user types — e.g. the move-out date. */
  protected readonly anchor = signal('');
  /** The user's own "must be received by" — `null` follows the anchor math. */
  private readonly deadlineOverride = signal<string | null>(null);
  /** The chosen VALARM offset in days; `null` = no alarm. */
  protected readonly alarmDays = signal<number | null>(DEFAULT_ALARM_DAYS);

  /** The date the dialog opened with — prefill isn't unsaved input (issue #151). */
  private initialDate = '';
  protected readonly confirmingDiscard = signal(false);

  /** Unsaved input — any field differs from what the dialog opened with. */
  readonly dirty = computed(
    () =>
      this.date() !== this.initialDate ||
      this.anchor() !== '' ||
      this.deadline() !== '' ||
      this.alarmDays() !== DEFAULT_ALARM_DAYS,
  );

  /** An implicit close of a dirty dialog asks first; a clean one closes. */
  protected onCloseRequested(): void {
    if (this.dirty()) this.confirmingDiscard.set(true);
    else this.closed.emit();
  }

  private readonly timing = computed<ActionTiming>(() => this.draft().item.timing);
  protected readonly kind = computed(() => this.timing().kind);
  protected readonly cleanRecurring = computed(() => isCleanCadence(this.timing()));

  /** The anchor field's label — "Anchor date — moving out". */
  protected readonly anchorLabel = computed(() => {
    const timing = this.timing();
    return timing.kind === 'NOTICE_PERIOD' ? `Anchor date — ${timing.anchor}` : '';
  });

  /** The computed "must be received by" — anchor minus the notice period. */
  protected readonly deadline = computed(() => {
    const timing = this.timing();
    if (timing.kind !== 'NOTICE_PERIOD') return '';
    const override = this.deadlineOverride();
    if (override !== null) return override;
    const anchor = this.anchor();
    return anchor ? subtractNotice(anchor, timing.duration, timing.unit) : '';
  });

  /** The loose-cadence note the description carries when no RRULE can. */
  protected readonly timingNote = computed(() => {
    const timing = this.timing();
    if (timing.kind === 'RECURRING' && !this.cleanRecurring()) {
      return `Repeats: ${timing.scheduleLabel}`;
    }
    if (timing.kind === 'NOTICE_PERIOD') {
      const unit = NOTICE_UNITS[timing.unit];
      return `Notice period: ${timing.duration} ${unit}${timing.duration === 1 ? '' : 's'} — ${timing.anchor}`;
    }
    return undefined;
  });

  /** The exported event's all-day date — the deadline for NOTICE_PERIOD. */
  protected readonly eventDate = computed(() =>
    this.kind() === 'NOTICE_PERIOD' ? this.deadline() : this.date(),
  );

  /** A past date warns but still exports (issue #104). */
  protected readonly past = computed(() => {
    const date = this.eventDate();
    return date !== '' && isPast(date, todayIso());
  });

  protected readonly canExport = computed(() => this.eventDate() !== '');

  /** The deadline line for FIXED_DATE — the one date that can't move. */
  protected readonly fixedDateLabel = computed(() => {
    const timing = this.timing();
    if (timing.kind !== 'FIXED_DATE') return '';
    return new Date(`${timing.dueDate}T00:00:00Z`).toLocaleDateString('en-GB', {
      dateStyle: 'full',
      timeZone: 'UTC',
    });
  });

  /** The event as currently confirmed — `null` until it can be exported. */
  private readonly event = computed<ReminderEvent | null>(() => {
    const date = this.eventDate();
    if (date === '') return null;
    const { doc, item } = this.draft();
    const deepLink = reminderDeepLink(this.draft().origin, doc.id, item);
    return {
      date,
      rrule: this.cleanRecurring() ? cleanRrule(this.timing(), date) : undefined,
      alarmDays: this.alarmDays() ?? undefined,
      title: reminderTitle(item, doc),
      description: reminderDescription({
        item,
        doc,
        deepLink,
        timingNote: this.timingNote(),
      }),
      uid: reminderUid(doc.id, item.id),
    };
  });

  protected readonly googleUrl = computed(() => {
    const event = this.event();
    return event === null ? null : googleCalendarUrl(event);
  });

  ngOnInit(): void {
    const timing = this.draft().item.timing;
    // Prefills per kind (issue #104): FIXED_DATE pins the deadline, a clean
    // cadence proposes its next occurrence, everything else asks the user.
    if (timing.kind === 'FIXED_DATE') this.date.set(timing.dueDate);
    else if (isCleanCadence(timing) && timing.kind === 'RECURRING' && timing.dayOfMonth !== undefined) {
      this.date.set(nextOccurrence(timing.dayOfMonth, todayIso()));
    }
    this.initialDate = this.date();
  }

  protected onDate(event: Event): void {
    this.date.set((event.target as HTMLInputElement).value);
  }

  protected onAnchor(event: Event): void {
    this.anchor.set((event.target as HTMLInputElement).value);
    // A fresh anchor re-derives the deadline — the user may edit it again.
    this.deadlineOverride.set(null);
  }

  protected onDeadline(event: Event): void {
    this.deadlineOverride.set((event.target as HTMLInputElement).value);
  }

  protected onAlarm(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.alarmDays.set(value === '' ? null : Number(value));
  }

  /** The `.ics` handoff — a blob download like the Document tile's. */
  protected downloadIcs(): void {
    const event = this.event();
    if (event === null) return;
    const { doc, item } = this.draft();
    const url = URL.createObjectURL(new Blob([buildIcs(event)], { type: 'text/calendar' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${doc.id}-${item.id}.ics`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
