/**
 * Tests for household rules on the phone (sync plan, PR 6).
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canChangeSharing,
  canDelete,
  isMuted,
  muteKey,
  filterItems,
  doneBy,
  afterLeaving,
  noLongerShared,
  householdChange,
  lookedAfterBy,
  canChooseWhoLooksAfter,
  canLookAfter,
  lookAfterChoices,
  lookedAfterName,
  withoutStaleLookedAfter,
  type HouseholdState,
} from './rules.ts';
import type { SinceItem } from '../../types/index.ts';

const ME = 'user-me';
const SAM = 'user-sam';
const HOME = 'household-home';

function item(id: string, extra: Partial<SinceItem> = {}): SinceItem {
  return {
    id,
    name: id,
    category: 'Household',
    lastDoneDate: '2026-10-01',
    history: [{ id: `${id}-e1`, date: '2026-10-01' }],
    repeatValue: null,
    repeatUnit: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

function state(myRole: 'owner' | 'member', mutes: string[] = []): HouseholdState {
  return {
    userId: ME,
    household: {
      id: HOME,
      name: 'Home',
      members: [
        { userId: ME, displayName: 'Alex', role: myRole },
        { userId: SAM, displayName: 'Sam', role: myRole === 'owner' ? 'member' : 'owner' },
      ],
    },
    mutes,
  };
}

const mine = item('mine');
const mineShared = item('mine-shared', { householdId: HOME });
const samsShared = item('sams-shared', { ownerId: SAM, householdId: HOME });

describe('who may do what (matches the database rules)', () => {
  test('only the person who added an item can change who it is for', () => {
    assert.equal(canChangeSharing(mine, state('member')), true);
    assert.equal(canChangeSharing(mineShared, state('member')), true);
    assert.equal(canChangeSharing(samsShared, state('owner')), false);
  });

  test('sharing needs a household', () => {
    assert.equal(canChangeSharing(mine, { userId: ME, household: null, mutes: [] }), false);
  });

  test("a member can delete their own items, not someone else's shared one", () => {
    assert.equal(canDelete(mine, state('member')), true);
    assert.equal(canDelete(mineShared, state('member')), true);
    assert.equal(canDelete(samsShared, state('member')), false);
  });

  test("the household's owner can delete anyone's shared item", () => {
    assert.equal(canDelete(samsShared, state('owner')), true);
  });

  test('without an account, everything on the phone is mine', () => {
    assert.equal(canDelete(mine, { userId: null, household: null, mutes: [] }), true);
  });
});

describe('the list', () => {
  test('All, Just me and Household', () => {
    const items = [mine, mineShared, samsShared];
    assert.deepEqual(filterItems(items, 'all').map((i) => i.id), ['mine', 'mine-shared', 'sams-shared']);
    assert.deepEqual(filterItems(items, 'mine').map((i) => i.id), ['mine']);
    assert.deepEqual(filterItems(items, 'household').map((i) => i.id), ['mine-shared', 'sams-shared']);
  });
});

describe('mutes and attribution', () => {
  test('a shared item is muted only when this member muted it', () => {
    assert.equal(isMuted(samsShared, state('member', [muteKey(samsShared, ME)])), true);
    assert.equal(isMuted(samsShared, state('member')), false);
    assert.equal(muteKey(mineShared, ME), `${ME}/mine-shared`);
  });

  test("a personal item is never muted, whatever's stored", () => {
    assert.equal(isMuted(mine, state('member', [muteKey(mine, ME)])), false);
  });

  test('"Done by" names the member on shared items only', () => {
    const fromSam = { id: 'e', date: '2026-10-02', createdBy: SAM };
    assert.equal(doneBy(samsShared, fromSam, state('member')), 'Done by Sam');
    assert.equal(doneBy(mine, fromSam, state('member')), null);
  });

  test('an entry not synced yet was done on this phone', () => {
    assert.equal(doneBy(samsShared, { id: 'e', date: '2026-10-02' }, state('member')), 'Done by Alex');
  });

  test("someone who's left isn't named", () => {
    assert.equal(doneBy(samsShared, { id: 'e', date: '2026-10-02', createdBy: 'user-gone' }, state('member')), null);
  });
});

describe('leaving', () => {
  test("after leaving, the household's items go from this phone and personal ones stay", () => {
    const other = item('other-household', { ownerId: SAM, householdId: 'elsewhere' });
    assert.deepEqual(afterLeaving([mine, mineShared, samsShared, other], HOME).map((i) => i.id), ['mine', 'other-household']);
  });
});

describe('items made personal again', () => {
  test("someone else's item no longer shared goes; this account's own never does", () => {
    const stillShared = item('still', { ownerId: SAM, householdId: HOME });
    const unshared = item('unshared', { ownerId: SAM, householdId: HOME });
    const keys = new Set([`${SAM}/still`]);
    assert.deepEqual(noLongerShared([mine, mineShared, stillShared, unshared], HOME, keys, ME), ['unshared']);
  });
});

describe('when the household changes', () => {
  const home = { id: HOME, name: 'Home', members: [] };
  const before = (household: typeof home | null, userId = ME): HouseholdState => ({ userId, household, mutes: [] });

  test('nothing changed: nothing to do', () => {
    assert.deepEqual(householdChange(before(home), ME, home), { left: null, pullEverything: false });
    assert.deepEqual(householdChange(before(null), ME, null), { left: null, pullEverything: false });
  });

  test("joining pulls everything, so items shared before this phone's last pull arrive", () => {
    assert.deepEqual(householdChange(before(null), ME, home), { left: null, pullEverything: true });
  });

  test("leaving (or being removed) clears the household's items and pulls again", () => {
    assert.deepEqual(householdChange(before(home), ME, null), { left: HOME, pullEverything: true });
  });

  test("another account's cached household is ignored", () => {
    assert.deepEqual(householdChange(before(home, SAM), ME, null), { left: null, pullEverything: false });
  });
});

describe('who looks after a shared item (matches 005_looked_after_by.sql)', () => {
  const OUTSIDER = 'user-outsider';
  const noHousehold: HouseholdState = { userId: ME, household: null, mutes: [] };

  test('any member can choose, on any shared item of their household', () => {
    assert.equal(canChooseWhoLooksAfter(mineShared, state('member')), true);
    assert.equal(canChooseWhoLooksAfter(samsShared, state('member')), true);
    assert.equal(canChooseWhoLooksAfter(samsShared, state('owner')), true);
  });

  test('never on a Just me item, another household\'s item, or outside a household', () => {
    assert.equal(canChooseWhoLooksAfter(mine, state('owner')), false);
    assert.equal(canChooseWhoLooksAfter(item('elsewhere', { householdId: 'other' }), state('owner')), false);
    assert.equal(canChooseWhoLooksAfter(mineShared, noHousehold), false);
  });

  test('a member or Anyone is accepted; an outsider, or anyone on a Just me item, is not', () => {
    assert.equal(canLookAfter(samsShared, ME, state('member')), true);
    assert.equal(canLookAfter(samsShared, SAM, state('member')), true);
    assert.equal(canLookAfter(samsShared, null, state('member')), true);
    assert.equal(canLookAfter(samsShared, OUTSIDER, state('member')), false);
    assert.equal(canLookAfter(mine, ME, state('member')), false);
    assert.equal(canLookAfter(mine, null, state('member')), true);
  });

  test('the choices are Anyone, You, then each other member', () => {
    assert.deepEqual(lookAfterChoices(state('member')), [
      { userId: null, label: 'Anyone' },
      { userId: ME, label: 'You' },
      { userId: SAM, label: 'Sam' },
    ]);
    assert.deepEqual(lookAfterChoices(noHousehold), [{ userId: null, label: 'Anyone' }]);
  });

  test('a Just me item never has anyone, even with a value left over (an older build unshared it)', () => {
    assert.equal(lookedAfterBy(item('x', { lookedAfterBy: SAM })), null);
    assert.equal(lookedAfterBy(item('x', { householdId: HOME, lookedAfterBy: SAM })), SAM);
    assert.equal(lookedAfterBy(item('x', { householdId: HOME, lookedAfterBy: null })), null);
    assert.equal(lookedAfterBy(mineShared), null);
  });

  test('named as You, by name, or not at all for someone this phone doesn\'t know', () => {
    assert.equal(lookedAfterName(item('x', { householdId: HOME, lookedAfterBy: ME }), state('member')), 'You');
    assert.equal(lookedAfterName(item('x', { householdId: HOME, lookedAfterBy: SAM }), state('member')), 'Sam');
    assert.equal(lookedAfterName(item('x', { householdId: HOME, lookedAfterBy: OUTSIDER }), state('member')), null);
    assert.equal(lookedAfterName(mineShared, state('member')), null);
  });

  test('someone who left, or a value on an item no longer shared, goes back to Anyone', () => {
    const home = state('member').household;
    const items = [
      item('sam', { householdId: HOME, lookedAfterBy: SAM }),
      item('gone', { householdId: HOME, lookedAfterBy: OUTSIDER }),
      item('unshared', { lookedAfterBy: SAM }),
      item('anyone', { householdId: HOME, lookedAfterBy: null }),
      item('old', { householdId: HOME }),
    ];
    assert.deepEqual(
      withoutStaleLookedAfter(items, home).map((i) => [i.id, i.lookedAfterBy]),
      [['gone', null], ['unshared', null]],
    );
    assert.deepEqual(withoutStaleLookedAfter(items, null).map((i) => i.id), ['sam', 'gone', 'unshared']);
  });
});
