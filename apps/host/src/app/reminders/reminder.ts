/**
 * Reminder building blocks (issue #122): the pure date math and the two
 * export formats — iCalendar (`.ics`) and the Google Calendar URL template —
 * for one Action Item's Reminder. All-day events only (`VALUE=DATE`),
 * relative `TRIGGER:-P{n}D` alarms, no timezones — per the #104 resolution.
 *
 * The dialog composes these per `ActionTiming` kind: FIXED_DATE pins the
 * date to the deadline; RECURRING exports an `RRULE` for clean cadences
 * (monthly/quarterly/yearly with `dayOfMonth`), else a single first date
 * with the cadence spelled out in the description; NOTICE_PERIOD derives
 * the "must be received by" date as anchor minus duration.
 */
import type {
  ActionTiming,
  IdentifiedActionItem,
  NoticeUnit,
} from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → the all-day `YYYYMMDD` the iCalendar formats use. */
export function icsDay(iso: string): string {
  return iso.replaceAll('-', '');
}

/** `YYYYMMDD` + one calendar day — DTEND of a one-day all-day event. */
export function nextDay(iso: string): string {
  return addDaysIso(iso, 1);
}

/** Adds `n` whole days to a `YYYY-MM-DD` date. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whether a `YYYY-MM-DD` date lies before today's `YYYY-MM-DD`. */
export function isPast(iso: string, todayIso: string): boolean {
  return iso < todayIso;
}

/** Today as `YYYY-MM-DD` in local time — the dialog's warning/next-occurrence base. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Whether a RECURRING timing maps onto a calendar `RRULE` (issue #104):
 * monthly/quarterly/yearly pinned to a `dayOfMonth`. Weekly cadences and
 * loose schedules ("3rd working day") can't — they export a first date
 * with the cadence spelled out instead.
 */
export function isCleanCadence(timing: ActionTiming): boolean {
  return (
    timing.kind === 'RECURRING' &&
    timing.dayOfMonth !== undefined &&
    ['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(timing.cadence)
  );
}

/**
 * The `RRULE` value (without the `RRULE:` prefix) for a clean cadence,
 * anchored on the confirmed first date: `BYMONTHDAY` follows the date the
 * user confirmed — not the extracted `dayOfMonth` — so `DTSTART` always
 * lands inside the rule's own recurrence set, never beside it.
 */
export function cleanRrule(timing: ActionTiming, firstDateIso: string): string | undefined {
  if (!isCleanCadence(timing) || timing.kind !== 'RECURRING') return undefined;
  const day = `BYMONTHDAY=${Number(firstDateIso.slice(8, 10))}`;
  switch (timing.cadence) {
    case 'MONTHLY':
      return `FREQ=MONTHLY;${day}`;
    case 'QUARTERLY':
      return `FREQ=MONTHLY;INTERVAL=3;${day}`;
    case 'YEARLY': {
      const month = Number(firstDateIso.slice(5, 7));
      return `FREQ=YEARLY;BYMONTH=${month};${day}`;
    }
    default:
      return undefined;
  }
}

/**
 * Anchor minus a notice period (issue #104): DAYS/WEEKS are exact day
 * arithmetic; MONTHS/YEARS subtract calendar periods, clamping to the
 * target month's length (31 May minus one month is 30 April).
 */
export function subtractNotice(anchorIso: string, duration: number, unit: NoticeUnit): string {
  switch (unit) {
    case 'DAYS':
      return addDaysIso(anchorIso, -duration);
    case 'WEEKS':
      return addDaysIso(anchorIso, -duration * 7);
    case 'MONTHS':
    case 'YEARS': {
      const [y, m, d] = anchorIso.split('-').map(Number);
      const months = unit === 'YEARS' ? duration * 12 : duration;
      const total = (y! * 12 + (m! - 1)) - months;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      const day = Math.min(d!, new Date(Date.UTC(year, month, 0)).getUTCDate());
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }
}

/** The event title (issue #104): `[Klartext] <action item> — <Document>`. */
export function reminderTitle(item: IdentifiedActionItem, doc: Pick<DocumentRecord, 'title'>): string {
  return `[Klartext] ${item.text} — ${doc.title}`;
}

/** Stable UID — re-importing the .ics updates the entry instead of duplicating. */
export function reminderUid(documentId: string, itemId: string): string {
  return `${documentId}-${itemId}@klartext`;
}

/**
 * The Folder-independent deep link into the Reminder's body (issue #104):
 * `/doc/<id>` plus the item's stable id and its cited page, so it lands on
 * the passage. `origin` is the Host's own — correct in every Environment.
 */
export function reminderDeepLink(
  origin: string,
  documentId: string,
  item: IdentifiedActionItem,
): string {
  const params = new URLSearchParams();
  if (item.page !== undefined) params.set('page', String(item.page));
  params.set('item', item.id);
  return `${origin}/doc/${documentId}?${params.toString()}`;
}

/**
 * The event body (issue #104): the plain-English explanation, the German
 * `sourceQuote`, and the deep link back into Klartext. A loose cadence —
 * one that exported no `RRULE` — is spelled out so the text carries it.
 */
export function reminderDescription(input: {
  item: IdentifiedActionItem;
  doc: Pick<DocumentRecord, 'title'>;
  deepLink: string;
  /** Extra timing context, e.g. "Repeats monthly by the 3rd working day". */
  timingNote?: string;
}): string {
  const { item, doc, deepLink, timingNote } = input;
  return [
    item.text,
    timingNote,
    `From "${doc.title}":\n"${item.sourceQuote}"`,
    `Open in Klartext: ${deepLink}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n\n');
}

/** One exportable Reminder event — the dialog's confirmed state. */
export interface ReminderEvent {
  /** `YYYY-MM-DD` of the all-day date (the first occurrence when recurring). */
  date: string;
  /** `RRULE` value for clean cadences; absent otherwise. */
  rrule?: string;
  /** Days before the event the VALARM fires; absent = no alarm. */
  alarmDays?: number;
  title: string;
  description: string;
  uid: string;
}

/** Escapes a TEXT property value (RFC 5545 §3.3.11). */
function icsEscape(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n');
}

/** Folds a content line to 75 octets, continuation lines space-prefixed (RFC 5545 §3.1). */
function foldLine(line: string): string[] {
  const encode = new TextEncoder();
  const lines: string[] = [];
  let rest = line;
  let budget = 75;
  while (encode.encode(rest).length > budget) {
    let cut = rest.length;
    while (encode.encode(rest.slice(0, cut)).length > budget) cut--;
    // Never split a surrogate pair — back off so the pair travels together.
    const last = rest.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut--;
    lines.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
    budget = 75;
  }
  lines.push(rest);
  return lines;
}

function toIcsDateTime(now: Date): string {
  return now.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * The `.ics` file body (issue #104): one all-day VEVENT — `VALUE=DATE`
 * dates, `DTEND` the day after, an `RRULE` on clean cadences, a relative
 * `TRIGGER:-P{n}D` VALARM when an offset was chosen.
 */
export function buildIcs(event: ReminderEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Klartext//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDateTime(now)}`,
    `DTSTART;VALUE=DATE:${icsDay(event.date)}`,
    `DTEND;VALUE=DATE:${icsDay(nextDay(event.date))}`,
    ...(event.rrule ? [`RRULE:${event.rrule}`] : []),
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(event.description)}`,
    ...(event.alarmDays !== undefined
      ? [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${icsEscape(event.title)}`,
          `TRIGGER:-P${event.alarmDays}D`,
          'END:VALARM',
        ]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(foldLine).join('\r\n')}\r\n`;
}

/**
 * The "Add to Google Calendar" URL template (issue #104): the same event
 * via `calendar.google.com/calendar/render?action=TEMPLATE` — the same
 * all-day `dates` range and `recur` for clean cadences. The template can't
 * express a VALARM, so the alarm choice only shapes the `.ics` download —
 * Google applies the user's own calendar defaults instead.
 */
export function googleCalendarUrl(event: ReminderEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsDay(event.date)}/${icsDay(nextDay(event.date))}`,
    details: event.description,
  });
  if (event.rrule) params.set('recur', `RRULE:${event.rrule}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
