/**
 * Tests for undoing "done" and undoing a delete.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canUndoDone, withoutCompletion, copyForRestore } from './undo.ts';
import type { SinceItem } from '../../types/index.ts';

function item(overrides: Partial<SinceItem> = {}): SinceItem {
  return {
    id: 'car',
    name: 'Car service',
    category: 'Auto',
    lastDoneDate: '2026-01-10',
    history: [{ id: 'e0', date: '2026-01-10' }],
    repeatValue: 6,
    repeatUnit: 'months',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = '2026-04-01T09:00:00.000Z';

describe('canUndoDone', () => {
  test('false when only the entry from adding the item is left', () => {
    assert.equal(canUndoDone(item()), false);
  });
  test('true once it has been marked done', () => {
    assert.equal(canUndoDone(item({ history: [{ id: 'e1', date: '2026-04-01' }, { id: 'e0', date: '2026-01-10' }] })), true);
  });
});

describe('withoutCompletion (undo done)', () => {
  const done = item({
    lastDoneDate: '2026-04-01',
    history: [{ id: 'e1', date: '2026-04-01' }, { id: 'e0', date: '2026-01-10' }],
  });

  test('puts back the exact previous last-done date and history', () => {
    const undone = withoutCompletion(done, 'e1', NOW, '2026-01-10');
    assert.ok(undone);
    assert.equal(undone.lastDoneDate, '2026-01-10');
    assert.deepEqual(undone.history, [{ id: 'e0', date: '2026-01-10' }]);
    assert.equal(undone.repeatValue, 6);
    assert.equal(undone.repeatUnit, 'months');
  });

  test('stamps updatedAt so sync (newest change wins) carries the undo to the cloud', () => {
    assert.equal(withoutCompletion(done, 'e1', NOW)?.updatedAt, NOW);
  });

  test('keeps a previous date that was edited away from history', () => {
    assert.equal(withoutCompletion(done, 'e1', NOW, '2026-02-02')?.lastDoneDate, '2026-02-02');
  });

  test('falls back to the newest remaining entry when no previous date is given', () => {
    const three = item({
      lastDoneDate: '2026-04-01',
      history: [
        { id: 'e2', date: '2026-04-01' },
        { id: 'e1', date: '2026-02-15' },
        { id: 'e0', date: '2026-01-10' },
      ],
    });
    const undone = withoutCompletion(three, 'e2', NOW);
    assert.equal(undone?.lastDoneDate, '2026-02-15');
    assert.deepEqual(undone?.history.map((e) => e.id), ['e1', 'e0']);
  });

  test('removing an older entry leaves lastDoneDate alone', () => {
    assert.equal(withoutCompletion(done, 'e0', NOW)?.lastDoneDate, '2026-04-01');
  });

  test('never removes the only entry', () => {
    assert.equal(withoutCompletion(item(), 'e0', NOW), null);
  });

  test('is a no-op (null) for an entry that is already gone, e.g. Undo tapped twice', () => {
    assert.equal(withoutCompletion(done, 'missing', NOW), null);
  });
});

describe('copyForRestore (undo delete)', () => {
  const deleted = item({
    lastDoneDate: '2026-02-15',
    history: [{ id: 'e1', date: '2026-02-15' }, { id: 'e0', date: '2026-01-10' }],
  });

  test('takes a new id: the old one is tombstoned in the cloud once the delete syncs', () => {
    const copy = copyForRestore(deleted, 'new-id', NOW);
    assert.equal(copy.id, 'new-id');
    assert.notEqual(copy.id, deleted.id);
  });

  test('keeps everything the user sees: name, category, dates, repeat and full history', () => {
    const copy = copyForRestore(deleted, 'new-id', NOW);
    assert.equal(copy.name, deleted.name);
    assert.equal(copy.category, deleted.category);
    assert.equal(copy.lastDoneDate, deleted.lastDoneDate);
    assert.deepEqual(copy.history, deleted.history);
    assert.equal(copy.repeatValue, deleted.repeatValue);
    assert.equal(copy.repeatUnit, deleted.repeatUnit);
    assert.equal(copy.createdAt, deleted.createdAt);
    assert.equal(copy.updatedAt, NOW);
  });
});
