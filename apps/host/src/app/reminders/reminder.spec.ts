import { describe, expect, it } from 'vitest';
import type { IdentifiedActionItem } from '@klartext/bus-contract';
import {
  addDaysIso,
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

const item = (over: Partial<IdentifiedActionItem> = {}): IdentifiedActionItem => ({
  id: 'ai_3f9c2e7b1d4a58',
  text: 'File your 2023 tax return by 31 July 2024, or a late-filing penalty applies.',
  sourceQuote: 'bis zum 31.07.2024 … Verspätungszuschlag',
  page: 1,
  timing: { kind: 'FIXED_DATE', dueDate: '2024-07-31' },
  ...over,
});

const DOC = { title: 'Brief vom Finanzamt' };

describe('subtractNotice', () => {
  it('subtracts exact days and weeks', () => {
    expect(subtractNotice('2026-06-15', 14, 'DAYS')).toBe('2026-06-01');
    expect(subtractNotice('2026-06-15', 2, 'WEEKS')).toBe('2026-06-01');
  });

  it('subtracts calendar months, clamping to the shorter month', () => {
    expect(subtractNotice('2026-06-30', 3, 'MONTHS')).toBe('2026-03-30');
    expect(subtractNotice('2026-05-31', 1, 'MONTHS')).toBe('2026-04-30');
  });

  it('subtracts calendar years across boundaries', () => {
    expect(subtractNotice('2026-03-01', 1, 'YEARS')).toBe('2025-03-01');
    expect(subtractNotice('2024-02-29', 1, 'YEARS')).toBe('2023-02-28');
  });
});

describe('isCleanCadence / cleanRrule', () => {
  it('accepts monthly, quarterly, and yearly pinned to a day of month', () => {
    for (const cadence of ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const) {
      expect(isCleanCadence({ kind: 'RECURRING', cadence, dayOfMonth: 3, scheduleLabel: 'x' })).toBe(true);
    }
  });

  it('rejects weekly cadences and unpinned schedules', () => {
    expect(isCleanCadence({ kind: 'RECURRING', cadence: 'WEEKLY', dayOfMonth: 3, scheduleLabel: 'x' })).toBe(false);
    expect(isCleanCadence({ kind: 'RECURRING', cadence: 'MONTHLY', scheduleLabel: 'x' })).toBe(false);
    expect(isCleanCadence({ kind: 'FIXED_DATE', dueDate: '2026-01-31' })).toBe(false);
  });

  it('builds the RRULE per cadence — yearly takes its month from the first date', () => {
    const base = { kind: 'RECURRING' as const, dayOfMonth: 3, scheduleLabel: 'x' };
    expect(cleanRrule({ ...base, cadence: 'MONTHLY' }, '2026-11-03')).toBe('FREQ=MONTHLY;BYMONTHDAY=3');
    expect(cleanRrule({ ...base, cadence: 'QUARTERLY' }, '2026-11-03')).toBe(
      'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=3',
    );
    expect(cleanRrule({ ...base, cadence: 'YEARLY' }, '2026-11-03')).toBe(
      'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3',
    );
    expect(cleanRrule({ kind: 'RECURRING', cadence: 'MONTHLY', scheduleLabel: 'x' }, '2026-11-03')).toBeUndefined();
  });

  it('follows the confirmed first date, so DTSTART never sits outside the rule', () => {
    // The user moved the first date to the 15th — the rule must too.
    expect(
      cleanRrule(
        { kind: 'RECURRING', cadence: 'MONTHLY', dayOfMonth: 3, scheduleLabel: 'x' },
        '2026-11-15',
      ),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });
});

describe('date helpers', () => {
  it('adds days across month boundaries', () => {
    expect(addDaysIso('2024-07-31', 1)).toBe('2024-08-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('compares ISO dates lexically for past-ness', () => {
    expect(isPast('2024-07-31', '2026-10-27')).toBe(true);
    expect(isPast('2026-10-27', '2026-10-27')).toBe(false);
  });

  it('formats today as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 9, 27))).toBe('2026-10-27');
  });
});

describe('reminder payload parts', () => {
  it('titles the event [Klartext] <item> — <Document>', () => {
    expect(reminderTitle(item(), DOC)).toBe(
      '[Klartext] File your 2023 tax return by 31 July 2024, or a late-filing penalty applies. — Brief vom Finanzamt',
    );
  });

  it('builds a stable UID so re-imports update rather than duplicate', () => {
    expect(reminderUid('doc-finanzamt', 'ai_3f9c2e7b1d4a58')).toBe(
      'doc-finanzamt-ai_3f9c2e7b1d4a58@klartext',
    );
  });

  it('deep-links /doc/<id> with the cited page and the item id', () => {
    expect(reminderDeepLink('http://localhost:4200', 'doc-finanzamt', item())).toBe(
      'http://localhost:4200/doc/doc-finanzamt?page=1&item=ai_3f9c2e7b1d4a58',
    );
  });

  it('omits page when the item cites none', () => {
    expect(reminderDeepLink('http://x', 'd', item({ page: undefined }))).toBe(
      'http://x/doc/d?item=ai_3f9c2e7b1d4a58',
    );
  });

  it('carries the explanation, the German quote, and the link', () => {
    const description = reminderDescription({
      item: item(),
      doc: DOC,
      deepLink: 'http://x/doc/d?item=ai_3f9c2e7b1d4a58',
      timingNote: 'Repeats monthly by the 3rd working day',
    });
    expect(description).toBe(
      'File your 2023 tax return by 31 July 2024, or a late-filing penalty applies.\n\n' +
        'Repeats monthly by the 3rd working day\n\n' +
        'From "Brief vom Finanzamt":\n' +
        '"bis zum 31.07.2024 … Verspätungszuschlag"\n\n' +
        'Open in Klartext: http://x/doc/d?item=ai_3f9c2e7b1d4a58',
    );
  });
});

describe('buildIcs', () => {
  const event: ReminderEvent = {
    date: '2024-07-31',
    alarmDays: 7,
    title: reminderTitle(item(), DOC),
    description: reminderDescription({ item: item(), doc: DOC, deepLink: 'http://x/doc/d?item=ai_3f9c2e7b1d4a58' }),
    uid: reminderUid('doc-finanzamt', 'ai_3f9c2e7b1d4a58'),
  };

  const ics = buildIcs(event, new Date(Date.UTC(2026, 9, 27, 12, 0, 0)));

  it('emits a one-day all-day VEVENT with the stable UID', () => {
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('DTSTART;VALUE=DATE:20240731');
    expect(ics).toContain('DTEND;VALUE=DATE:20240801');
    expect(ics).toContain('UID:doc-finanzamt-ai_3f9c2e7b1d4a58@klartext');
    expect(ics).toContain('DTSTAMP:20261027T120000Z');
  });

  it('escapes TEXT values — commas, semicolons, and newlines', () => {
    // Folded lines re-join by dropping the CRLF + leading space (RFC 5545 §3.1).
    const unfolded = ics.replaceAll('\r\n ', '');
    expect(unfolded).toContain('SUMMARY:[Klartext] File your 2023 tax return by 31 July 2024\\, or a late-filing penalty applies. — Brief vom Finanzamt');
    expect(unfolded).toContain('Verspätungszuschlag"\\n\\nOpen in Klartext');
  });

  it('emits the VALARM as a relative day trigger', () => {
    expect(ics).toContain('TRIGGER:-P7D');
    expect(ics).toContain('BEGIN:VALARM');
  });

  it('omits VALARM when no offset was chosen', () => {
    const noAlarm = buildIcs({ ...event, alarmDays: undefined });
    expect(noAlarm).not.toContain('VALARM');
  });

  it('carries the RRULE for clean cadences', () => {
    const recurring = buildIcs({ ...event, rrule: 'FREQ=MONTHLY;BYMONTHDAY=3' });
    expect(recurring).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=3');
  });

  it('uses CRLF line endings and folds every line to 75 octets', () => {
    expect(ics).not.toMatch(/[^\r]\n/);
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('never splits a surrogate pair across a fold', () => {
    // The emoji lands exactly on the 75-octet boundary — a naive fold cuts
    // it in half. 'SUMMARY:' is 8 octets, 64 x's take it to 72.
    const ics = buildIcs({ ...event, title: `${'x'.repeat(64)}🔥` });
    const offending = ics
      .split('\r\n')
      .filter(
        (l) =>
          (l.charCodeAt(l.length - 1) >= 0xd800 && l.charCodeAt(l.length - 1) <= 0xdbff) ||
          (l.charCodeAt(0) >= 0xdc00 && l.charCodeAt(0) <= 0xdfff),
      );
    expect(offending).toEqual([]);
    expect(ics.replaceAll('\r\n ', '')).toContain('🔥');
  });
});

describe('googleCalendarUrl', () => {
  const event: ReminderEvent = {
    date: '2024-07-31',
    title: reminderTitle(item(), DOC),
    description: 'Body',
    uid: 'u',
  };

  it('renders the template URL with the all-day date range', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(event.title);
    expect(url.searchParams.get('dates')).toBe('20240731/20240801');
    expect(url.searchParams.get('details')).toBe('Body');
    expect(url.searchParams.get('recur')).toBeNull();
  });

  it('carries recur=RRULE for clean cadences', () => {
    const url = new URL(googleCalendarUrl({ ...event, rrule: 'FREQ=MONTHLY;BYMONTHDAY=3' }));
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=3');
  });
});
