/**
 * Tests for the "By category" list view: grouping and order.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupByCategory, NO_CATEGORY } from './rules.ts';

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
