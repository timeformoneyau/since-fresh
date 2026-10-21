/**
 * Tests for what gets scheduled, and when: lifecycle reminders, grouped
 * overdue notices, the 2-a-day cap and snoozes. Not that Android delivers it.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'date-fns';
import { planNotifications, MAX_PER_DAY, type PlannedNotification } from './plan.ts';
import { makeSnooze, type Snoozes } from '../domain/snooze/rules.ts';
import type { SinceItem } from '../types';

// Wednesday 21 Oct 2026, 8am local
const NOW = new Date(2026, 9, 21, 8, 0);

function item(id: string, lastDoneDate: string, repeatValue: number | null = 1, repeatUnit: SinceItem['repeatUnit'] = 'months'): SinceItem {
  return {
    id, name: id, category: 'Household', lastDoneDate,
    history: [{ id: `${id}-e`, date: lastDoneDate }],
    repeatValue, repeatUnit, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

const when = (n: PlannedNotification) => format(n.triggerDate, 'yyyy-MM-dd HH:mm');
const summary = (ns: PlannedNotification[]) => ns.map((n) => `${when(n)} ${n.identifier} ${n.body}`);

function perDay(ns: PlannedNotification[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of ns) {
    const d = format(n.triggerDate, 'yyyy-MM-dd');
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return m;
}

function snoozed(it: SinceItem, option: Parameters<typeof makeSnooze>[1]): Snoozes {
  return { [it.id]: makeSnooze(it, option, NOW) };
}

describe('the schedule', () => {
  test('a monthly item gets coming up, due today, 7 days overdue and grouped, at 9am', () => {
    // Done 1 Oct, so due 1 Nov and everything is still ahead
    const plan = planNotifications([item('Dentist', '2026-10-01')], { now: NOW });
    assert.deepEqual(summary(plan), [
      '2026-10-29 09:00 since_Dentist_coming_up Dentist due in 3 days',
      '2026-11-01 09:00 since_Dentist_due Dentist due today',
      '2026-11-08 09:00 since_Dentist_overdue_7 Dentist overdue by 7 days',
      '2026-11-22 09:00 since_grouped_2026-11-22 Something might need your attention',
      '2026-12-06 09:00 since_grouped_2026-12-06 Something might need your attention',
      '2026-12-20 09:00 since_grouped_2026-12-20 Something might need your attention',
      '2027-01-03 09:00 since_grouped_2027-01-03 Something might need your attention',
    ]);
  });

  test('once off items get nothing, and past times are left out', () => {
    assert.deepEqual(planNotifications([item('Passport', '2026-01-01', null, null)], { now: NOW }), []);
    for (const n of planNotifications([item('Bins', '2026-09-11')], { now: NOW })) {
      assert.ok(n.triggerDate > NOW);
    }
  });

  test('grouped notices count every item 21+ days overdue that day', () => {
    const plan = planNotifications([item('A', '2026-09-11'), item('B', '2026-09-11'), item('C', '2026-09-11')], { now: NOW });
    const grouped = plan.filter((n) => n.identifier.includes('grouped'));
    assert.equal(grouped[0].body, '3 things might need attention');
    assert.equal(when(grouped[0]), '2026-11-01 09:00');
  });
});

describe('the reminder time', () => {
  test('every reminder, grouped notice and end of snooze goes out at the chosen time', () => {
    const overdue = item('Gutters', '2026-09-11');
    const plan = planNotifications([item('Dentist', '2026-10-01'), overdue], {
      now: NOW,
      time: { hour: 18, minute: 30 },
      snoozes: snoozed(overdue, '1-week'),
    });
    assert.ok(plan.length > 5);
    for (const n of plan) assert.equal(format(n.triggerDate, 'HH:mm'), '18:30');
  });

  test("today's reminder still goes out if the time is later today, not if it has passed", () => {
    const dueToday = item('Bins', '2026-09-21');
    const at = (hour: number) =>
      planNotifications([dueToday], { now: NOW, time: { hour, minute: 0 } }).some((n) => n.identifier === 'since_Bins_due');
    assert.equal(at(7), false); // 7am has passed (now is 8am)
    assert.equal(at(12), true);
  });
});

describe('the daily cap', () => {
  test(`never more than ${MAX_PER_DAY} on one day`, () => {
    const items = ['A', 'B', 'C', 'D'].map((id) => item(id, '2026-10-01'));
    const plan = planNotifications(items, { now: NOW });
    for (const count of perDay(plan).values()) assert.ok(count <= MAX_PER_DAY);
    assert.equal(perDay(plan).get('2026-11-01'), 2);
  });

  test('a higher priority notice wins the day', () => {
    // A is 7 days overdue on 1 Nov (due 25 Oct); B and C are due that day
    const plan = planNotifications(
      [item('A', '2026-09-25'), item('B', '2026-10-01'), item('C', '2026-10-01')],
      { now: NOW },
    );
    const ids = plan.filter((n) => when(n).startsWith('2026-11-01')).map((n) => n.identifier);
    assert.ok(ids.includes('since_A_overdue_7'));
    assert.equal(ids.length, 2);
  });
});

describe('snooze', () => {
  // Due 11 Oct, so 10 days overdue today
  const overdue = item('Gutters', '2026-09-11');

  test('nothing until it ends, then one normal reminder that day', () => {
    const plan = planNotifications([overdue], { now: NOW, snoozes: snoozed(overdue, '1-week') });
    assert.deepEqual(summary(plan), [
      '2026-10-28 09:00 since_Gutters_snooze_end Gutters overdue by 17 days',
      '2026-11-01 09:00 since_grouped_2026-11-01 Something might need your attention',
      '2026-11-15 09:00 since_grouped_2026-11-15 Something might need your attention',
      '2026-11-29 09:00 since_grouped_2026-11-29 Something might need your attention',
      '2026-12-13 09:00 since_grouped_2026-12-13 Something might need your attention',
    ]);
  });

  test('grouped notices skip it while snoozed and count it again afterwards', () => {
    const other = item('Filter', '2026-09-11');
    const plan = planNotifications([overdue, other], { now: NOW, snoozes: snoozed(overdue, '1-month') });
    const grouped = plan.filter((n) => n.identifier.includes('grouped')).map((n) => `${when(n)} ${n.body}`);
    assert.deepEqual(grouped, [
      '2026-11-01 09:00 Something might need your attention',       // Filter only
      '2026-11-15 09:00 Something might need your attention',       // Filter only
      '2026-11-29 09:00 A couple of things might need attention',   // both again
      '2026-12-13 09:00 A couple of things might need attention',
    ]);
    assert.ok(plan.some((n) => n.identifier === 'since_Gutters_snooze_end' && when(n) === '2026-11-21 09:00'));
  });

  test('a snoozed item takes no place in the cap', () => {
    // All three due today at 9am (now is 8am)
    const items = ['A', 'B', 'C'].map((id) => item(id, '2026-09-21'));
    const plan = planNotifications(items, { now: NOW, snoozes: snoozed(items[0], '3-days') });
    const today = plan.filter((n) => when(n).startsWith('2026-10-21')).map((n) => n.identifier).sort();
    assert.deepEqual(today, ['since_B_due', 'since_C_due']);
  });

  test('the end-of-snooze reminder competes in the cap like a 7-day overdue', () => {
    // B and C are due on 28 Oct, the day Gutters' week-long snooze ends
    const b = item('B', '2026-09-28');
    const c = item('C', '2026-09-28');
    const plan = planNotifications([overdue, b, c], { now: NOW, snoozes: snoozed(overdue, '1-week') });
    const that = plan.filter((n) => when(n).startsWith('2026-10-28')).map((n) => n.identifier);
    assert.equal(that.length, 2);
    assert.ok(that.includes('since_Gutters_snooze_end'));
  });

  test('done since, repeat changed, or ended: back to the usual schedule', () => {
    const s = snoozed(overdue, '1-week');
    const usual = summary(planNotifications([item('Gutters', '2026-10-20')], { now: NOW }));
    assert.deepEqual(summary(planNotifications([item('Gutters', '2026-10-20')], { now: NOW, snoozes: s })), usual);

    const weekly = item('Gutters', '2026-09-11', 2, 'weeks');
    assert.ok(!planNotifications([weekly], { now: NOW, snoozes: s }).some((n) => n.identifier.endsWith('snooze_end')));

    const later = new Date(2026, 9, 29, 8, 0);
    assert.ok(!planNotifications([overdue], { now: later, snoozes: s }).some((n) => n.identifier.endsWith('snooze_end')));
  });
});
