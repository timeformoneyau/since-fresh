import type { RepeatUnit } from '../types';

interface Suggestion {
  repeatValue: number;
  repeatUnit: RepeatUnit;
}

/** Shown on an empty list to tap and add (Add opens filled in; nothing is saved until "Track this"). */
interface Starter {
  name: string;
  category: string;
  /** Opens on "Until it's due" (the due date is asked), repeating after it when `repeat`. */
  until?: { repeat: boolean };
}

/**
 * Common things and their usual gaps: the one source for the suggestion while
 * typing a name (Add) and for the starters on an empty list. Gaps are neutral
 * memory aids for an Australian household, not advice; every one can be
 * changed before saving. First matching rule wins, so specific keywords come
 * before general ones.
 */
const RULES: Array<{ keywords: string[]; suggestion: Suggestion; starter?: Starter }> = [
  { keywords: ['smoke', 'alarm', 'detector', 'battery'], suggestion: { repeatValue: 12, repeatUnit: 'months' }, starter: { name: 'Smoke alarm battery', category: 'Household' } },
  { keywords: ['dentist', 'dental', 'hygienist'], suggestion: { repeatValue: 6, repeatUnit: 'months' }, starter: { name: 'Dentist', category: 'Health' } },
  { keywords: ['car service', 'car serv', 'oil change', 'service car'], suggestion: { repeatValue: 12, repeatUnit: 'months' }, starter: { name: 'Car service', category: 'Auto' } },
  { keywords: ['rego', 'registration'], suggestion: { repeatValue: 12, repeatUnit: 'months' }, starter: { name: 'Car rego', category: 'Auto', until: { repeat: true } } },
  { keywords: ['air-con', 'aircon', 'air con', 'split system'], suggestion: { repeatValue: 3, repeatUnit: 'months' }, starter: { name: 'Air-con filter', category: 'Household' } },
  { keywords: ['gutter'], suggestion: { repeatValue: 12, repeatUnit: 'months' }, starter: { name: 'Gutters', category: 'Household' } },
  { keywords: ['pest', 'termite'], suggestion: { repeatValue: 12, repeatUnit: 'months' }, starter: { name: 'Pest inspection', category: 'Household' } },
  { keywords: ['eye', 'optom', 'glasses', 'vision'], suggestion: { repeatValue: 24, repeatUnit: 'months' }, starter: { name: 'Eye test', category: 'Health' } },
  { keywords: ['tyre', 'tire', 'tyres', 'tires', 'rotate'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
  { keywords: ['air filter', 'airfilter', 'hvac', 'furnace filter'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
  { keywords: ['filter', 'washing machine', 'dishwasher'], suggestion: { repeatValue: 3, repeatUnit: 'months' } },
  { keywords: ['solar panel', 'solar'], suggestion: { repeatValue: 12, repeatUnit: 'months' } },
  { keywords: ['blood pressure', 'cholesterol', 'health check', 'check-up'], suggestion: { repeatValue: 12, repeatUnit: 'months' } },
  { keywords: ['fridge', 'refrigerator', 'coils'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
];

export function getSuggestion(name: string): Suggestion | null {
  const lower = name.toLowerCase().trim();
  if (lower.length < 3) return null;

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.suggestion;
    }
  }
  return null;
}

/**
 * Names that usually have a date to work to rather than a last time done.
 * Add only preselects "Until it's due" for them; nothing else changes.
 */
const UNTIL_KEYWORDS = [
  'rego', 'registration', 'licence', 'license', 'passport', 'subscription', 'trial', 'renewal', 'insurance',
];

/** Whether Add should start on "Until it's due" for this name. */
export function suggestsUntil(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return lower.length >= 3 && UNTIL_KEYWORDS.some((kw) => lower.includes(kw));
}

/** The starters, in the order shown, each with its usual gap. */
export const STARTERS: Array<Starter & Suggestion> = RULES.flatMap((r) =>
  r.starter ? [{ ...r.starter, ...r.suggestion }] : [],
);
