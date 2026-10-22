/**
 * How the main list is shown: "Most urgent" (one list, as always), "By
 * category" (the same order, under category headings) or, in a household,
 * "By person" (under who looks after each item). Pure, so it runs under
 * `npm test`; store.ts keeps the choice on this phone.
 */

import type { SinceItem } from '../../types';
import { isShared, lookedAfterBy, type HouseholdState } from '../household/rules.ts';

export type ListView = 'urgent' | 'category' | 'person';

export const DEFAULT_LIST_VIEW: ListView = 'urgent';

export const LIST_VIEWS: { key: ListView; label: string }[] = [
  { key: 'urgent', label: 'Most urgent' },
  { key: 'category', label: 'By category' },
  { key: 'person', label: 'By person' },
];

/** The views offered: "By person" only in a household. */
export function listViewsFor(inHousehold: boolean): { key: ListView; label: string }[] {
  return inHousehold ? LIST_VIEWS : LIST_VIEWS.filter((v) => v.key !== 'person');
}

/** The view to show: a saved "By person" shows as Most urgent outside a household. */
export function effectiveListView(view: ListView, inHousehold: boolean): ListView {
  return view === 'person' && !inHousehold ? DEFAULT_LIST_VIEW : view;
}

/** Storage format version. Later versions may add fields only. */
export const LIST_VIEW_VERSION = 1;

/** Heading for an item saved with no category (possible in old or synced data). */
export const NO_CATEGORY = 'No category';

export interface CategoryGroup<T> {
  /** The heading shown, and a stable key. */
  title: string;
  items: T[];
}

/** A "By person" group: its heading, and a key that a member's name can't clash with. */
export interface PersonGroup<T> extends CategoryGroup<T> {
  key: string;
}

export const PERSON_HEADINGS = { you: 'You', anyone: 'Anyone' } as const;

/**
 * Group an already most-urgent-first list by category. Groups come in the
 * order of their most urgent item, and items keep their order inside each
 * group, so nothing is reordered relative to the flat list. Any category
 * gets its own heading (old "Food" items, ones from other phones, empty);
 * nothing is dropped.
 */
export function groupByCategory<T extends Pick<SinceItem, 'category'>>(sorted: T[]): CategoryGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of sorted) {
    const title = item.category?.trim() || NO_CATEGORY;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

/**
 * Group an already most-urgent-first list by who looks after each item:
 * You first (what you look after, and your Just me items), then each other
 * member in joining order, then Anyone. Items keep their order inside each
 * group; empty groups are left out. Someone this phone doesn't know as a
 * member (they've just left) counts as Anyone, as the server will make it.
 */
export function groupByPerson<T extends SinceItem>(sorted: T[], state: HouseholdState): PersonGroup<T>[] {
  const others = (state.household?.members ?? []).filter((m) => m.userId !== state.userId);
  const known = new Set(others.map((m) => m.userId));
  const you: T[] = [];
  const anyone: T[] = [];
  const byMember = new Map<string, T[]>(others.map((m) => [m.userId, []]));
  for (const item of sorted) {
    const who = lookedAfterBy(item);
    if (!isShared(item) || (who !== null && who === state.userId)) you.push(item);
    else if (who !== null && known.has(who)) byMember.get(who)!.push(item);
    else anyone.push(item);
  }
  return [
    { key: 'you', title: PERSON_HEADINGS.you, items: you },
    ...others.map((m) => ({ key: `member-${m.userId}`, title: m.displayName, items: byMember.get(m.userId)! })),
    { key: 'anyone', title: PERSON_HEADINGS.anyone, items: anyone },
  ].filter((g) => g.items.length > 0);
}

/** What was saved, or "Most urgent" when nothing (or nothing readable) was. */
export function parseListView(raw: string | null): ListView {
  if (!raw) return DEFAULT_LIST_VIEW;
  try {
    const { view } = JSON.parse(raw) as { view?: unknown };
    return LIST_VIEWS.some((v) => v.key === view) ? (view as ListView) : DEFAULT_LIST_VIEW;
  } catch {
    return DEFAULT_LIST_VIEW;
  }
}

export function serializeListView(view: ListView): string {
  return JSON.stringify({ version: LIST_VIEW_VERSION, view });
}
