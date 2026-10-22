/**
 * How the main list is shown: "Most urgent" (one list, as always) or "By
 * category" (the same order, under category headings). Pure, so it runs
 * under `npm test`; store.ts keeps the choice on this phone.
 */

import type { SinceItem } from '../../types';

export type ListView = 'urgent' | 'category';

export const DEFAULT_LIST_VIEW: ListView = 'urgent';

export const LIST_VIEWS: { key: ListView; label: string }[] = [
  { key: 'urgent', label: 'Most urgent' },
  { key: 'category', label: 'By category' },
];

/** Storage format version. Later versions may add fields only. */
export const LIST_VIEW_VERSION = 1;

/** Heading for an item saved with no category (possible in old or synced data). */
export const NO_CATEGORY = 'No category';

export interface CategoryGroup<T> {
  /** The heading shown, and a stable key. */
  title: string;
  items: T[];
}

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
