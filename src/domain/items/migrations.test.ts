/**
 * Tests for local storage migration.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndMigrate, toEnvelope, STORAGE_VERSION } from './migrations.ts';
import { mergeItems, type CloudEntry } from '../sync/runSync.ts';
import { parseSnoozes, serializeSnoozes, makeSnooze } from '../snooze/rules.ts';
import { parseReminderTime, serializeReminderTime } from '../../notifications/reminderTime.ts';
import { parseListView, serializeListView } from '../listView/rules.ts';
import { readPrefs } from '../../notifications/permission.ts';

const base = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('parseAndMigrate', () => {
  test('an old food item becomes tracked-only and keeps its name and category', () => {
    const raw = JSON.stringify({
      version: 2,
      items: [
        {
          ...base,
          id: 'milk',
          name: 'Milk',
          category: 'Food',
          lastDoneDate: '2026-03-01',
          history: [],
          repeatValue: 7,
          repeatUnit: 'days',
          expiryDate: '2026-03-08',
          source: 'photo',
        },
      ],
    });

    const [item] = parseAndMigrate(raw);

    assert.equal(item.name, 'Milk');
    assert.equal(item.category, 'Food');
    assert.equal(item.repeatValue, null);
    assert.equal(item.repeatUnit, null);
    assert.deepEqual(item.history, [{ id: 'milk_seed', date: '2026-03-01' }]);
    assert.ok(!('expiryDate' in item));
    assert.ok(!('source' in item));
  });

  test('a normal repeat item passes through unchanged apart from the stripped fields', () => {
    const stored = {
      ...base,
      id: 'filter',
      name: 'Change water filter',
      category: 'Household',
      lastDoneDate: '2026-02-10',
      history: [
        { id: 'e2', date: '2026-02-10' },
        { id: 'e1', date: '2025-11-10' },
      ],
      repeatValue: 3,
      repeatUnit: 'months',
    };
    const raw = JSON.stringify({
      version: 2,
      items: [{ ...stored, expiryDate: null, source: 'manual' }],
    });

    assert.deepEqual(parseAndMigrate(raw), [stored]);
  });

  test('a legacy bare-array payload still loads', () => {
    const raw = JSON.stringify([
      {
        ...base,
        id: 'dentist',
        name: 'Dentist',
        category: 'Health',
        lastDoneDate: '2025-12-01',
        repeatValue: 6,
        repeatUnit: 'months',
      },
    ]);

    const items = parseAndMigrate(raw);

    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'Dentist');
    assert.deepEqual(items[0].history, [{ id: 'dentist_seed', date: '2025-12-01' }]);
    assert.ok(!('expiryDate' in items[0]));
  });

  test('storage version is 3', () => {
    assert.equal(STORAGE_VERSION, 3);
  });
});

describe('history (redesign)', () => {
  const stored = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      version: 3,
      items: [
        {
          ...base,
          id: 'hair',
          name: 'Haircut',
          category: 'Health',
          lastDoneDate: '2026-09-11',
          repeatValue: 30,
          repeatUnit: 'days',
          ...overrides,
        },
      ],
    });

  test('an item with lastDoneDate and no history gets a one-entry history; a second run changes nothing', () => {
    const once = parseAndMigrate(stored({}));
    assert.deepEqual(once[0].history, [{ id: 'hair_seed', date: '2026-09-11' }]);
    assert.equal(once[0].lastDoneDate, '2026-09-11');

    const twice = parseAndMigrate(JSON.stringify({ version: STORAGE_VERSION, items: once }));
    assert.deepEqual(twice, once);
  });

  test('entries written before the redesign (no note or createdAt) load unchanged', () => {
    const history = [
      { id: 'b', date: '2026-09-11' },
      { id: 'a', date: '2026-08-09' },
    ];
    assert.deepEqual(parseAndMigrate(stored({ history }))[0].history, history);
  });

  test('note and createdAt on entries are kept', () => {
    const history = [
      { id: 'b', date: '2026-09-11', note: 'Shorter', createdAt: '2026-09-11T08:00:00.000Z' },
      { id: 'a', date: '2026-08-09' },
    ];
    assert.deepEqual(parseAndMigrate(stored({ history }))[0].history, history);
  });

  test('a lastDoneDate moved later by the old Edit screen gets its own entry, so it never moves back', () => {
    const history = [{ id: 'a', date: '2026-08-09' }];
    const items = parseAndMigrate(stored({ lastDoneDate: '2026-09-11', history }));
    assert.equal(items[0].lastDoneDate, '2026-09-11');
    assert.deepEqual(items[0].history, [
      { id: 'hair_last_2026-09-11', date: '2026-09-11' },
      { id: 'a', date: '2026-08-09' },
    ]);
    // Idempotent
    const again = parseAndMigrate(JSON.stringify({ version: STORAGE_VERSION, items }));
    assert.deepEqual(again, items);
  });

  test('a lastDoneDate between entries is slotted into date order; nothing is removed', () => {
    const history = [
      { id: 'c', date: '2026-10-01' },
      { id: 'a', date: '2026-08-09' },
    ];
    const items = parseAndMigrate(stored({ lastDoneDate: '2026-09-11', history }));
    assert.deepEqual(items[0].history.map((e) => e.id), ['c', 'hair_last_2026-09-11', 'a']);
    assert.equal(items[0].lastDoneDate, '2026-09-11');
  });

  test('an item saved by the redesigned app still loads in the shape older builds read', () => {
    const history = [{ id: 'b', date: '2026-09-11', note: 'x', createdAt: '2026-09-11T08:00:00.000Z' }];
    const [item] = parseAndMigrate(stored({ history }));
    // Older builds read history[0] as the latest entry and need lastDoneDate
    assert.equal(item.history[0].date, item.lastDoneDate);
    assert.equal(typeof item.lastDoneDate, 'string');
  });
});

describe('optional sign-in', () => {
  // Signing in is now optional, so a list can be built up with no account and
  // adopted by the first sign-in (sync/ownership.ts). The stored list must
  // load whole either way: old ids and new UUIDs alike, nothing dropped.
  test('a list saved with no account loads whole and unchanged, ready to adopt', () => {
    const items = [
      {
        ...base,
        id: 'lq3x9a0k2m',
        name: 'Gutters',
        category: 'Household',
        lastDoneDate: '2026-05-01',
        history: [{ id: 'e1', date: '2026-05-01' }],
        repeatValue: 6,
        repeatUnit: 'months',
      },
      {
        ...base,
        id: '6f1c2b0e-8a5d-4c1e-9b7a-2d3e4f5a6b7c',
        name: 'Haircut',
        category: 'Other',
        lastDoneDate: '2026-10-01',
        history: [
          { id: '0c9d8e7f-1a2b-4c3d-8e9f-0a1b2c3d4e5f', date: '2026-10-01', createdAt: '2026-10-01T09:00:00.000Z' },
        ],
        repeatValue: null,
        repeatUnit: null,
      },
    ];
    const raw = JSON.stringify({ version: STORAGE_VERSION, items });
    assert.deepEqual(parseAndMigrate(raw), items);
  });
});

describe('entries synced one by one (sync plan, PR 3)', () => {
  // A sync now merges cloud items (which carry a server change time) and
  // cloud history entries into the list. What it saves must be the same
  // stored shape as before, so this build and older ones load it unchanged.
  test('a list saved after a sync has no cloud-only fields and loads unchanged', () => {
    const local = {
      ...base,
      id: 'gutters',
      name: 'Gutters',
      category: 'Household',
      lastDoneDate: '2026-09-01',
      history: [{ id: 'e1', date: '2026-09-01' }],
      repeatValue: 6,
      repeatUnit: 'months' as const,
    };
    const fromCloud = { ...local, name: 'Clean gutters', serverUpdatedAt: '2026-10-20T00:00:01.000Z' };
    const entry: CloudEntry = {
      itemId: 'gutters', id: 'e2', date: '2026-10-10', note: 'Ladder', createdAt: '2026-10-10T08:00:00.000Z',
      deletedAt: null, serverUpdatedAt: '2026-10-20T00:00:02.000Z',
    };

    const merged = mergeItems([local], [fromCloud], new Set(), [entry]);
    assert.equal('serverUpdatedAt' in merged[0], false);

    const loaded = parseAndMigrate(toEnvelope(merged));
    assert.deepEqual(loaded, merged);
    // Older builds read history[0] as the latest entry, and lastDoneDate
    assert.equal(loaded[0].history[0].id, 'e2');
    assert.equal(loaded[0].lastDoneDate, '2026-10-10');
  });
});

describe('households (sync plan, PR 6)', () => {
  // Shared items carry an owner and household, and entries who did them.
  // All optional: lists saved before load as they were, and older builds
  // ignore the new fields.
  test('a shared item, with its owner, household and "done by", loads unchanged', () => {
    const shared = {
      ...base,
      id: 'bins',
      name: 'Bins',
      category: 'Household',
      lastDoneDate: '2026-10-05',
      history: [
        { id: 'e2', date: '2026-10-05', createdBy: 'user-sam' },
        { id: 'e1', date: '2026-10-01' },
      ],
      repeatValue: 1,
      repeatUnit: 'weeks',
      ownerId: 'user-sam',
      householdId: 'household-home',
    };
    assert.deepEqual(parseAndMigrate(toEnvelope([shared] as never)), [shared]);
  });

  test('an item saved before households has none of the new fields after loading', () => {
    const [old] = parseAndMigrate(JSON.stringify({
      version: 3,
      items: [{ ...base, id: 'a', name: 'A', category: 'Other', lastDoneDate: '2026-01-01', history: [{ id: 'e', date: '2026-01-01' }], repeatValue: null, repeatUnit: null }],
    }));
    assert.equal('ownerId' in old, false);
    assert.equal('householdId' in old, false);
  });
});

describe('who looks after a shared item (Shared load)', () => {
  // One new optional field, lookedAfterBy. Storage version stays 3: lists
  // saved before load as they were, and builds before it keep the field when
  // they save (items are loaded and saved whole, unknown fields included).
  const bins = {
    ...base,
    id: 'bins',
    name: 'Bins',
    category: 'Household',
    lastDoneDate: '2026-10-05',
    history: [{ id: 'e1', date: '2026-10-05' }],
    repeatValue: 1,
    repeatUnit: 'weeks' as const,
    ownerId: 'user-sam',
    householdId: 'household-home',
  };

  test('a shared item someone looks after loads unchanged, and saves the same', () => {
    const looked = { ...bins, lookedAfterBy: 'user-sam' };
    assert.equal(STORAGE_VERSION, 3);
    assert.deepEqual(parseAndMigrate(toEnvelope([looked] as never)), [looked]);
    assert.deepEqual(parseAndMigrate(toEnvelope(parseAndMigrate(toEnvelope([looked] as never)))), [looked]);
    const anyone = { ...bins, lookedAfterBy: null };
    assert.deepEqual(parseAndMigrate(toEnvelope([anyone] as never)), [anyone]);
  });

  test('an item saved by the current app (no field) loads with none', () => {
    const [loaded] = parseAndMigrate(JSON.stringify({ version: 3, items: [bins] }));
    assert.equal('lookedAfterBy' in loaded, false);
    assert.deepEqual(loaded, bins);
  });

  test("another member's choice arriving by sync replaces this phone's, unless a change is waiting here", () => {
    const [local] = parseAndMigrate(JSON.stringify({ version: 3, items: [bins] }));
    const cloud = { ...bins, lookedAfterBy: 'user-me', serverUpdatedAt: '2026-10-06T00:00:00Z' };
    assert.equal(mergeItems([local], [cloud], new Set())[0].lookedAfterBy, 'user-me');

    const mine = { ...local, lookedAfterBy: 'user-sam' };
    const pending = { items: new Set(['bins']), entries: new Set<string>(), deletedEntries: new Set<string>() };
    assert.equal(mergeItems([mine], [cloud], new Set(), [], pending as never)[0].lookedAfterBy, 'user-sam');

    const backToAnyone = { ...cloud, lookedAfterBy: null };
    assert.equal(mergeItems([mine], [backToAnyone], new Set())[0].lookedAfterBy, null);
  });
});

describe('snooze ("Not yet"), kept beside the list on this phone', () => {
  // Snoozes live under their own key (@since_snoozes_v1). The list's stored
  // shape doesn't change, so this build and older ones load it as before.
  const gutters = {
    ...base,
    id: 'gutters',
    name: 'Gutters',
    category: 'Household',
    lastDoneDate: '2026-09-01',
    history: [{ id: 'e1', date: '2026-09-01' }],
    repeatValue: 1,
    repeatUnit: 'months' as const,
  };

  test('a list saved by the current app loads unchanged, with or without a snooze', () => {
    const saved = toEnvelope([gutters]);
    assert.deepEqual(parseAndMigrate(saved), [gutters]);
    // Snoozing writes only the snooze key, never the list
    serializeSnoozes({ gutters: makeSnooze(gutters, '1-week', new Date(2026, 9, 21)) });
    assert.deepEqual(parseAndMigrate(saved), [gutters]);
    assert.equal(JSON.parse(saved).version, STORAGE_VERSION);
  });

  test('no snoozes saved yet (every phone before this build) is no snoozes', () => {
    assert.deepEqual(parseSnoozes(null), {});
  });

  test('unreadable snooze data is ignored rather than breaking reminders', () => {
    assert.deepEqual(parseSnoozes('not json'), {});
    assert.deepEqual(parseSnoozes(JSON.stringify({ version: 1 })), {});
    assert.deepEqual(parseSnoozes(JSON.stringify({ version: 1, snoozes: { a: { until: 'soon' } } })), {});
  });

  test('a snooze saved by a newer build with extra fields still loads', () => {
    const raw = JSON.stringify({
      version: 2,
      snoozes: { gutters: { until: '2026-10-28', lastDoneDate: '2026-09-01', repeatValue: 1, repeatUnit: 'months', reason: 'away' } },
    });
    assert.equal(parseSnoozes(raw).gutters.until, '2026-10-28');
  });
});

describe('reminder time, kept beside the list on this phone', () => {
  // Its own key (@since_reminder_time_v1); the list's stored shape is unchanged.
  test('nothing saved yet (every phone before this build) is 9 am, as before', () => {
    assert.deepEqual(parseReminderTime(null), { hour: 9, minute: 0 });
  });

  test('a saved time round trips', () => {
    assert.deepEqual(parseReminderTime(serializeReminderTime({ hour: 18, minute: 0 })), { hour: 18, minute: 0 });
  });

  test('unreadable or impossible values fall back to 9 am', () => {
    for (const raw of ['nope', '{}', JSON.stringify({ hour: 25, minute: 0 }), JSON.stringify({ hour: 7.5, minute: 0 })]) {
      assert.deepEqual(parseReminderTime(raw), { hour: 9, minute: 0 });
    }
  });

  test('a time saved by a newer build with extra fields still loads', () => {
    assert.deepEqual(parseReminderTime(JSON.stringify({ version: 2, hour: 7, minute: 0, weekends: 9 })), { hour: 7, minute: 0 });
  });
});

describe('starters on an empty list', () => {
  // A starter only fills in the Add form; what's saved is an ordinary item.
  test('an item made from a starter has the usual stored shape and loads unchanged', () => {
    const fromStarter = {
      ...base,
      id: 'smoke',
      name: 'Smoke alarm battery',
      category: 'Household',
      lastDoneDate: '2026-10-21',
      history: [{ id: 'e1', date: '2026-10-21', createdAt: base.createdAt }],
      repeatValue: 12,
      repeatUnit: 'months' as const,
    };
    assert.deepEqual(parseAndMigrate(toEnvelope([fromStarter])), [fromStarter]);
  });
});

describe('list view, kept beside the list on this phone', () => {
  // Its own key (@since_list_view_v1); the list's stored shape is unchanged.
  test('nothing saved yet (every phone before this build) is "Most urgent", as before', () => {
    assert.equal(parseListView(null), 'urgent');
  });

  test('a saved choice round trips', () => {
    assert.equal(parseListView(serializeListView('category')), 'category');
    assert.equal(parseListView(serializeListView('urgent')), 'urgent');
  });

  test('unreadable or unknown values fall back to "Most urgent"', () => {
    for (const raw of ['nope', '{}', 'null', JSON.stringify({ version: 1, view: 'alphabetical' }), JSON.stringify({ view: 3 })]) {
      assert.equal(parseListView(raw), 'urgent', raw);
    }
  });

  test('"By person" is saved in the same format (version 1); builds before it read it as "Most urgent"', () => {
    const raw = serializeListView('person');
    assert.deepEqual(JSON.parse(raw), { version: 1, view: 'person' });
    assert.equal(parseListView(raw), 'person');
    // An older build only knows urgent and category: its unknown-value rule
    // (above, 'alphabetical') makes this Most urgent after a rollback
  });

  test('a choice saved by a newer build with extra fields still loads', () => {
    assert.equal(parseListView(JSON.stringify({ version: 2, view: 'category', collapsed: ['Auto'] })), 'category');
  });

  test('a list with items in any category loads unchanged', () => {
    const items = ['Household', 'Food', 'Marine', ''].map((category, i) => ({
      ...base, id: `i${i}`, name: `Item ${i}`, category,
      lastDoneDate: '2026-10-01', history: [{ id: `e${i}`, date: '2026-10-01' }],
      repeatValue: null, repeatUnit: null,
    }));
    assert.deepEqual(parseAndMigrate(toEnvelope(items)), items);
  });
});

describe('Play hardening B: nothing saved before changes shape', () => {
  test('an item with every field the current release writes loads unchanged', () => {
    const item = {
      ...base,
      id: 'gutters',
      name: 'Gutters',
      category: 'Household',
      lastDoneDate: '2026-09-01',
      history: [
        { id: 'e2', date: '2026-09-01', note: 'Both sides', createdAt: '2026-09-01T08:00:00.000Z', createdBy: 'sam' },
        { id: 'e1', date: '2026-03-01' },
      ],
      repeatValue: 6,
      repeatUnit: 'months' as const,
      ownerId: 'sam',
      householdId: 'home',
      lookedAfterBy: 'sam',
    };
    assert.deepEqual(parseAndMigrate(toEnvelope([item])), [item]);
  });

  test("the reminders prompt answers (@since_reminder_prompt_v1): new, optional, and absent reads as not asked", () => {
    assert.deepEqual(readPrefs(JSON.parse(JSON.stringify({ explained: true }))), { explained: true });
    assert.deepEqual(readPrefs(JSON.parse(JSON.stringify({ explained: true, noticeDismissed: true }))), {
      explained: true,
      noticeDismissed: true,
    });
    assert.deepEqual(readPrefs(null), {});
  });
});
