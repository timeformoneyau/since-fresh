/**
 * Tests for the "By category" list view: grouping and order.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByCategory,
  NO_CATEGORY,
  groupByPerson,
  listViewsFor,
  effectiveListView,
  parseListView,
  serializeListView,
} from './rules.ts';
import type { SinceItem } from '../../types/index.ts';
import type { HouseholdState } from '../household/rules.ts';

// Already most-urgent-first, as the screen passes it (sortItems)
const item = (name: string, category: string) => ({ name, category });
const titles = (groups: { title: string }[]) => groups.map((g) => g.title);
const names = (groups: { items: { name: string }[] }[]) => groups.map((g) => g.items.map((i) => i.name));

describe('groupByCategory', () => {
  test('an empty list has no groups', () => {
    assert.deepEqual(groupByCategory([]), []);
  });

  test('one category is one group, in the same order', () => {
    const sorted = [item('Gutters', 'Household'), item('Filter', 'Household')];
    assert.deepEqual(titles(groupByCategory(sorted)), ['Household']);
    assert.deepEqual(names(groupByCategory(sorted)), [['Gutters', 'Filter']]);
  });

  test('groups come in the order of their most urgent item; items keep their order', () => {
    const sorted = [
      item('Rego', 'Auto'),         // most urgent overall
      item('Dentist', 'Health'),
      item('Tyres', 'Auto'),
      item('Gutters', 'Household'),
      item('Eye test', 'Health'),
    ];
    const groups = groupByCategory(sorted);
    assert.deepEqual(titles(groups), ['Auto', 'Health', 'Household']);
    assert.deepEqual(names(groups), [['Rego', 'Tyres'], ['Dentist', 'Eye test'], ['Gutters']]);
  });

  test('ties keep the flat list\'s order, so both views always agree', () => {
    // Equally urgent: whichever the flat list shows first leads
    const a = groupByCategory([item('Bins', 'Household'), item('Car wash', 'Auto')]);
    const b = groupByCategory([item('Car wash', 'Auto'), item('Bins', 'Household')]);
    assert.deepEqual(titles(a), ['Household', 'Auto']);
    assert.deepEqual(titles(b), ['Auto', 'Household']);
  });

  test('categories outside the defaults get their own heading, never dropped', () => {
    const sorted = [
      item('Milk', 'Food'),             // left by the old food feature
      item('Boat', 'Marine'),           // from another phone or a backup file
      item('Mystery', ''),              // empty
      item('Spaces', '   '),            // blank
      item('Dentist', 'Health'),
    ];
    const groups = groupByCategory(sorted);
    assert.deepEqual(titles(groups), ['Food', 'Marine', NO_CATEGORY, 'Health']);
    assert.deepEqual(names(groups)[2], ['Mystery', 'Spaces']);
    assert.equal(groups.reduce((n, g) => n + g.items.length, 0), sorted.length);
  });

  test('"No category" stays apart from a real "Other"', () => {
    const groups = groupByCategory([item('A', 'Other'), item('B', '')]);
    assert.deepEqual(titles(groups), ['Other', NO_CATEGORY]);
  });
});

describe('groupByPerson', () => {
  const ME = 'user-me';
  const SAM = 'user-sam';
  const JO = 'user-jo';
  const HOME = 'home';
  const state: HouseholdState = {
    userId: ME,
    household: {
      id: HOME,
      name: 'Home',
      members: [
        { userId: SAM, displayName: 'Sam', role: 'owner' },
        { userId: ME, displayName: 'Alex', role: 'member' },
        { userId: JO, displayName: 'Jo', role: 'member' },
      ],
    },
    mutes: [],
  };
  const it = (name: string, extra: Partial<SinceItem> = {}): SinceItem => ({
    id: name, name, category: 'Household', lastDoneDate: '2026-10-01',
    history: [{ id: `${name}-e`, date: '2026-10-01' }], repeatValue: 1, repeatUnit: 'months',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...extra,
  });

  test('You first (what you look after and your Just me items), then each member, then Anyone', () => {
    // Already most-urgent-first
    const sorted = [
      it('Bins', { householdId: HOME }),                     // Anyone
      it('Gutters', { householdId: HOME, lookedAfterBy: JO }),
      it('Dentist'),                                         // Just me
      it('Filter', { householdId: HOME, lookedAfterBy: ME }),
      it('Rego', { householdId: HOME, lookedAfterBy: SAM }),
      it('Mower', { householdId: HOME, lookedAfterBy: null }),
    ];
    const groups = groupByPerson(sorted, state);
    assert.deepEqual(titles(groups), ['You', 'Sam', 'Jo', 'Anyone']);
    assert.deepEqual(names(groups), [['Dentist', 'Filter'], ['Rego'], ['Gutters'], ['Bins', 'Mower']]);
    assert.deepEqual(groups.map((g) => g.key), ['you', `member-${SAM}`, `member-${JO}`, 'anyone']);
  });

  test('empty groups are left out, and nothing is dropped', () => {
    const sorted = [it('Bins', { householdId: HOME }), it('Dentist')];
    assert.deepEqual(titles(groupByPerson(sorted, state)), ['You', 'Anyone']);
    assert.deepEqual(groupByPerson([], state), []);
  });

  test("someone this phone doesn't know as a member counts as Anyone", () => {
    const groups = groupByPerson([it('Bins', { householdId: HOME, lookedAfterBy: 'user-gone' })], state);
    assert.deepEqual(titles(groups), ['Anyone']);
  });

  test('a member called "You" or "Anyone" still gets their own group', () => {
    const odd: HouseholdState = { ...state, household: { ...state.household!, members: [
      { userId: ME, displayName: 'Alex', role: 'owner' },
      { userId: SAM, displayName: 'Anyone', role: 'member' },
    ] } };
    const groups = groupByPerson([it('Bins', { householdId: HOME }), it('Rego', { householdId: HOME, lookedAfterBy: SAM })], odd);
    assert.deepEqual(groups.map((g) => g.key), [`member-${SAM}`, 'anyone']);
  });
});

describe('the By person choice', () => {
  test('offered only in a household', () => {
    assert.deepEqual(listViewsFor(true).map((v) => v.label), ['Most urgent', 'By category', 'By person']);
    assert.deepEqual(listViewsFor(false).map((v) => v.label), ['Most urgent', 'By category']);
  });

  test('a saved By person is remembered, and shows as Most urgent outside a household', () => {
    assert.equal(parseListView(serializeListView('person')), 'person');
    assert.equal(effectiveListView('person', true), 'person');
    assert.equal(effectiveListView('person', false), 'urgent');
    assert.equal(effectiveListView('category', false), 'category');
  });
});
