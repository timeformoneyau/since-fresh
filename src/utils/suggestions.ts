import { RepeatUnit } from '../types';

interface Suggestion {
  repeatValue: number;
  repeatUnit: RepeatUnit;
}

const RULES: Array<{ keywords: string[]; suggestion: Suggestion }> = [
  { keywords: ['dentist', 'dental', 'hygienist'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
  { keywords: ['tyre', 'tire', 'tyres', 'tires', 'rotate'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
  { keywords: ['smoke', 'alarm', 'detector', 'battery'], suggestion: { repeatValue: 12, repeatUnit: 'months' } },
  { keywords: ['air filter', 'airfilter', 'hvac', 'furnace filter'], suggestion: { repeatValue: 6, repeatUnit: 'months' } },
  { keywords: ['car service', 'car serv', 'oil change', 'service car'], suggestion: { repeatValue: 12, repeatUnit: 'months' } },
  { keywords: ['eye', 'optom', 'glasses', 'vision'], suggestion: { repeatValue: 24, repeatUnit: 'months' } },
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
