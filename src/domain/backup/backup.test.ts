/**
 * Tests for backup files (sync plan, PR 4).
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toBackup,
  readBackup,
  planRestore,
  describeRestore,
  backupFileName,
  BackupError,
  BACKUP_COPY,
} from './backup.ts';
import type { SinceItem } from '../../types/index.ts';

const NOW = '2026-10-20T09:00:00.000Z';

function item(id: string, entries: Array<[string, string]>, extra: Partial<SinceItem> = {}): SinceItem {
  const history = entries.map(([eid, date]) => ({ id: eid, date })).sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    id,
    name: id,
    category: 'Household',
    lastDoneDate: history[0].date,
    history,
    repeatValue: 6,
    repeatUnit: 'months',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

let n = 0;
const newId = () => `new-${++n}`;

describe('reading and writing a backup', () => {
  test('a backup round-trips: everything that was exported comes back', () => {
    const items = [
      item('gutters', [['e1', '2026-05-01'], ['e2', '2026-10-01']]),
      item('dentist', [['d1', '2026-04-01']], { repeatValue: null, repeatUnit: null }),
    ];
    items[0].history[0].note = 'Used the long ladder';
    assert.deepEqual(readBackup(toBackup(items, NOW)), items);
  });

  test('a backup carries a marker, its version and when it was made', () => {
    const b = JSON.parse(toBackup([], NOW));
    assert.equal(b.format, 'since-backup');
    assert.equal(b.version, 1);
    assert.equal(b.exportedAt, NOW);
  });

  test('items from older builds in a backup are brought up to date, like stored data', () => {
    const raw = JSON.stringify({
      format: 'since-backup',
      version: 1,
      storageVersion: 1,
      items: [{ id: 'old', name: 'Old', category: 'Other', lastDoneDate: '2026-01-01', createdAt: NOW, updatedAt: NOW, repeatValue: null, repeatUnit: null }],
    });
    const [old] = readBackup(raw);
    assert.equal(old.history.length, 1, 'history is seeded from lastDoneDate');
  });

  test("anything that isn't a backup is refused, plainly", () => {
    for (const raw of ['not json', '[]', '{}', JSON.stringify({ version: 3, items: [] })]) {
      assert.throws(() => readBackup(raw), (e: unknown) => e instanceof BackupError && e.message === BACKUP_COPY.notABackup);
    }
  });

  test('a backup from a newer version asks to update the app', () => {
    const raw = JSON.stringify({ format: 'since-backup', version: 2, items: [] });
    assert.throws(() => readBackup(raw), (e: unknown) => e instanceof BackupError && e.message === BACKUP_COPY.tooNew);
  });

  test('the file is named for the day', () => {
    assert.equal(backupFileName('2026-10-20'), 'since-backup-2026-10-20.json');
  });
});

describe('restoring merges, never replaces', () => {
  test('an item not on the phone is added under a new id, everything else kept', () => {
    const backup = [item('gone', [['e1', '2026-05-01']])];
    const plan = planRestore([], backup, newId, NOW);
    assert.equal(plan.added.length, 1);
    assert.notEqual(plan.added[0].id, 'gone');
    assert.deepEqual({ ...plan.added[0], id: 'gone', updatedAt: backup[0].updatedAt }, backup[0]);
  });

  test("a shared item from someone else's backup comes back as this account's own, just for me", () => {
    const shared = item('theirs', [['e1', '2026-05-01']], { ownerId: 'user-sam', householdId: 'home' });
    const [added] = planRestore([], [shared], newId, NOW).added;
    assert.equal('ownerId' in added, false);
    assert.equal('householdId' in added, false);
  });

  test('a backup keeps who looks after a shared item; an item added from it has nobody (Just me)', () => {
    const shared = item('bins', [['e1', '2026-05-01']], { householdId: 'home', lookedAfterBy: 'user-sam' });
    assert.equal(readBackup(toBackup([shared], NOW))[0].lookedAfterBy, 'user-sam');
    const [added] = planRestore([], [shared], newId, NOW).added;
    assert.equal('householdId' in added, false);
    assert.equal('lookedAfterBy' in added, false);
  });

  test('an item already here keeps who looks after it, whatever the backup says', () => {
    const local = [item('bins', [['e2', '2026-10-01']], { householdId: 'home', lookedAfterBy: 'user-me' })];
    const backup = [item('bins', [['e1', '2026-05-01']], { householdId: 'home', lookedAfterBy: 'user-sam' })];
    assert.equal(planRestore(local, backup, newId, NOW).extended[0].item.lookedAfterBy, 'user-me');
  });

  test("an item already here gains only the entries it's missing; its fields stay", () => {
    const local = [item('gutters', [['e2', '2026-10-01']], { name: 'Clean gutters' })];
    const backup = [item('gutters', [['e1', '2026-05-01'], ['e2', '2026-10-01']], { name: 'Gutters' })];
    const plan = planRestore(local, backup, newId, NOW);
    assert.equal(plan.added.length, 0);
    assert.equal(plan.extended.length, 1);
    assert.deepEqual(plan.extended[0].entryIds, ['e1']);
    assert.equal(plan.extended[0].item.name, 'Clean gutters');
    assert.deepEqual(plan.extended[0].item.history.map((e) => e.id), ['e2', 'e1']);
  });

  test("an entry here that's been edited isn't overwritten by the backup's copy", () => {
    const local = [item('gutters', [['e1', '2026-05-01']])];
    local[0].history[0].note = 'Edited since';
    const backup = [item('gutters', [['e1', '2026-05-01']])];
    const plan = planRestore(local, backup, newId, NOW);
    assert.equal(plan.extended.length, 0);
  });

  test('restoring the same backup twice adds nothing the second time', () => {
    const local = [item('gutters', [['e1', '2026-05-01']])];
    const backup = [item('gutters', [['e1', '2026-05-01'], ['e2', '2026-06-01']])];
    const first = planRestore(local, backup, newId, NOW);
    const after = [first.extended[0].item];
    assert.equal(describeRestore(planRestore(after, backup, newId, NOW)), null);
  });

  test('an item restored under a new id is recognised next time, so the same file never duplicates it', () => {
    const backup = [item('gone', [['e1', '2026-05-01']])];
    const first = planRestore([], backup, newId, NOW);
    assert.equal(first.added.length, 1);
    assert.equal(describeRestore(planRestore(first.added, backup, newId, NOW)), null);
  });

  test('the preview counts what will be added', () => {
    const local = [item('gutters', [['e1', '2026-05-01']])];
    const backup = [
      item('gutters', [['e1', '2026-05-01'], ['e2', '2026-06-01']]),
      item('dentist', [['d1', '2026-04-01'], ['d2', '2026-10-01']]),
    ];
    assert.equal(describeRestore(planRestore(local, backup, newId, NOW)), '1 item, 3 entries. Add to your list?');
    assert.equal(
      describeRestore(planRestore([], [item('a', [['x', '2026-01-01']])], newId, NOW)),
      '1 item, 1 entry. Add to your list?',
    );
    assert.equal(describeRestore(planRestore(local, [local[0]], newId, NOW)), null);
  });
});
