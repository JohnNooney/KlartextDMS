import { describe, expect, it } from 'vitest';
import type { ActionTiming } from './extraction.js';
import { actionUrgency, nextOccurrence } from './urgency.js';

const TODAY = new Date(2026, 9, 22); // Thu 22 Oct 2026, local

const fixed = (dueDate: string): ActionTiming => ({ kind: 'FIXED_DATE', dueDate });

describe('actionUrgency — FIXED_DATE', () => {
  it('buckets a passed deadline as Overdue, labelled absolutely beyond the week window', () => {
    expect(actionUrgency(fixed('2024-07-31'), TODAY)).toEqual({
      urgency: 'overdue',
      label: 'Due 31 Jul 2024',
      dueDate: '2024-07-31',
    });
  });

  it('buckets today through seven days ahead as This week, yesterday as Overdue, eight days as Later', () => {
    const bucket = (d: string) => actionUrgency(fixed(d), TODAY).urgency;
    expect(['2026-10-21', '2026-10-22', '2026-10-29', '2026-10-30'].map(bucket)).toEqual([
      'overdue',
      'thisWeek',
      'thisWeek',
      'later',
    ]);
  });

  it('labels relatively inside the week window and absolutely beyond it', () => {
    const label = (d: string) => actionUrgency(fixed(d), TODAY).label;
    expect({
      weekAgo: label('2026-10-15'),
      fiveAgo: label('2026-10-17'),
      yesterday: label('2026-10-21'),
      today: label('2026-10-22'),
      tomorrow: label('2026-10-23'),
      inThree: label('2026-10-25'),
      inSeven: label('2026-10-29'),
      inEight: label('2026-10-30'),
      eightAgo: label('2026-10-14'),
    }).toEqual({
      weekAgo: 'Due 7 days ago',
      fiveAgo: 'Due 5 days ago',
      yesterday: 'Due yesterday',
      today: 'Due today',
      tomorrow: 'Due tomorrow',
      inThree: 'Due in 3 days',
      inSeven: 'Due in 7 days',
      inEight: 'Due 30 Oct 2026',
      eightAgo: 'Due 14 Oct 2026',
    });
  });
});

describe('actionUrgency — RECURRING', () => {
  const monthly = (dayOfMonth?: number): ActionTiming => ({
    kind: 'RECURRING',
    cadence: 'MONTHLY',
    dayOfMonth,
    scheduleLabel: 'Monthly rent',
  });

  it('buckets a monthly day-of-month item by its next occurrence, prefixing the relative due label when near', () => {
    expect(actionUrgency(monthly(25), TODAY)).toEqual({
      urgency: 'thisWeek',
      label: 'Due in 3 days · Monthly rent',
      dueDate: '2026-10-25',
    });
    expect(actionUrgency(monthly(22), TODAY)).toMatchObject({
      urgency: 'thisWeek',
      label: 'Due today · Monthly rent',
    });
  });

  it('files a further-out next occurrence under Later with the schedule label', () => {
    expect(actionUrgency(monthly(3), TODAY)).toEqual({
      urgency: 'later',
      label: 'Monthly rent',
      dueDate: '2026-11-03',
    });
  });

  it('is never Overdue: a day already passed this month rolls to next month', () => {
    expect(actionUrgency(monthly(21), TODAY)).toEqual({
      urgency: 'later',
      label: 'Monthly rent',
      dueDate: '2026-11-21',
    });
    expect(actionUrgency(monthly(5), new Date(2026, 11, 30))).toMatchObject({
      urgency: 'thisWeek',
      label: 'Due in 6 days · Monthly rent',
      dueDate: '2027-01-05',
    });
  });

  it('keeps loosely specified recurrences under Later with no date', () => {
    const later = { urgency: 'later', label: 'Monthly rent', dueDate: null };
    expect(actionUrgency(monthly(), TODAY)).toEqual(later);
    for (const cadence of ['WEEKLY', 'QUARTERLY', 'YEARLY'] as const) {
      expect(
        actionUrgency({ kind: 'RECURRING', cadence, dayOfMonth: 25, scheduleLabel: 'Monthly rent' }, TODAY),
      ).toEqual(later);
    }
  });
});

describe('nextOccurrence', () => {
  it('returns this month’s date when the day is still ahead', () => {
    expect(nextOccurrence(15, '2026-10-27')).toBe('2026-11-15');
    expect(nextOccurrence(28, '2026-10-27')).toBe('2026-10-28');
  });

  it('returns today itself when the day matches', () => {
    expect(nextOccurrence(27, '2026-10-27')).toBe('2026-10-27');
  });

  it('skips months too short for the day', () => {
    expect(nextOccurrence(31, '2026-02-10')).toBe('2026-03-31');
    expect(nextOccurrence(31, '2026-04-01')).toBe('2026-05-31');
  });

  it('crosses the year boundary', () => {
    expect(nextOccurrence(5, '2026-12-20')).toBe('2027-01-05');
  });
});

describe('actionUrgency — NOTICE_PERIOD and NONE', () => {
  it('files a notice period under Later, labelled with duration and anchor', () => {
    expect(
      actionUrgency({ kind: 'NOTICE_PERIOD', duration: 3, unit: 'MONTHS', anchor: 'moving out' }, TODAY),
    ).toEqual({ urgency: 'later', label: '3 months’ notice · moving out', dueDate: null });
    expect(
      actionUrgency({ kind: 'NOTICE_PERIOD', duration: 1, unit: 'WEEKS', anchor: 'contract end' }, TODAY).label,
    ).toBe('1 week’s notice · contract end');
  });

  it('gives an undated item No date and no label', () => {
    expect(actionUrgency({ kind: 'NONE' }, TODAY)).toEqual({ urgency: 'noDate', label: null, dueDate: null });
  });
});
