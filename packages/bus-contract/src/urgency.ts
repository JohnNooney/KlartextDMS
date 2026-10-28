/**
 * Action Item Urgency (ADR 0012): the single definition of how soon an
 * Action Item's timing comes due, derived at read time against `today` and
 * shared so the Host and Guest bucket and label it identically.
 */
import type { ActionTiming, NoticeUnit } from './extraction.js';

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const NOTICE_UNITS: Record<NoticeUnit, string> = {
  DAYS: 'day',
  WEEKS: 'week',
  MONTHS: 'month',
  YEARS: 'year',
};

export type Urgency = 'overdue' | 'thisWeek' | 'later' | 'noDate';

/** The user-facing name of each Urgency bucket, most urgent first. */
export const URGENCY_LABELS: Record<Urgency, string> = {
  overdue: 'Overdue',
  thisWeek: 'This week',
  later: 'Later',
  noDate: 'No date',
};

export interface ActionUrgency {
  urgency: Urgency;
  /** The timing label both apps show: "Due in 3 days", "Due 31 Jul 2024", "3 months’ notice · moving out"; `null` for `NONE`. */
  label: string | null;
  /** The `YYYY-MM-DD` the item next comes due, when computable — orders dated items. */
  dueDate: string | null;
}

/**
 * Buckets an Action Item's timing against `today` (local calendar day) and
 * labels it. `FIXED_DATE` by whole days to the deadline; `RECURRING` only for
 * `MONTHLY` with `dayOfMonth`, by its next occurrence and never Overdue;
 * `NOTICE_PERIOD` is always Later (its anchor is an event); `NONE` is No date.
 */
export function actionUrgency(timing: ActionTiming, today: Date): ActionUrgency {
  const todayIso = localIso(today);
  switch (timing.kind) {
    case 'FIXED_DATE': {
      const days = daysBetween(todayIso, timing.dueDate);
      return { urgency: bucket(days), label: dueLabel(days, timing.dueDate), dueDate: timing.dueDate };
    }
    case 'RECURRING': {
      if (timing.cadence !== 'MONTHLY' || timing.dayOfMonth === undefined) {
        return { urgency: 'later', label: timing.scheduleLabel, dueDate: null };
      }
      const dueDate = nextOccurrence(timing.dayOfMonth, todayIso);
      const days = daysBetween(todayIso, dueDate);
      const urgency = bucket(days);
      const label = urgency === 'thisWeek' ? `${dueLabel(days, dueDate)} · ${timing.scheduleLabel}` : timing.scheduleLabel;
      return { urgency, label, dueDate };
    }
    case 'NOTICE_PERIOD': {
      const { duration, unit, anchor } = timing;
      const word = NOTICE_UNITS[unit] + (duration === 1 ? '’s' : 's’');
      return { urgency: 'later', label: `${duration} ${word} notice · ${anchor}`, dueDate: null };
    }
    case 'NONE':
      return { urgency: 'noDate', label: null, dueDate: null };
  }
}

/**
 * The next date carrying `dayOfMonth` on or after `todayIso` (`YYYY-MM-DD`).
 * Months too short for the day are skipped (a 31st falls through to the next
 * month that has one).
 */
export function nextOccurrence(dayOfMonth: number, todayIso: string): string {
  let year = Number(todayIso.slice(0, 4));
  let month = Number(todayIso.slice(5, 7));
  for (let i = 0; i < 14; i++) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (dayOfMonth <= daysInMonth) {
      const candidate = `${year}-${pad2(month)}-${pad2(dayOfMonth)}`;
      if (candidate >= todayIso) return candidate;
    }
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return todayIso; // unreachable: dayOfMonth ≤ 31 and a 31-day month exists within 14 months
}

function bucket(days: number): Urgency {
  return days < 0 ? 'overdue' : days <= WEEK_DAYS ? 'thisWeek' : 'later';
}

/** Relative inside the week window either side of today, absolute beyond it. */
function dueLabel(days: number, iso: string): string {
  if (days === 0) return 'Due today';
  if (days === -1) return 'Due yesterday';
  if (days === 1) return 'Due tomorrow';
  if (days < 0 && days >= -WEEK_DAYS) return `Due ${-days} days ago`;
  if (days > 0 && days <= WEEK_DAYS) return `Due in ${days} days`;
  return `Due ${utcDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDate(toIso).getTime() - utcDate(fromIso).getTime()) / DAY_MS);
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
