import { COMPANY_LABELS, CYCLING_LABELS, INTEREST_LABELS, PACE_LABELS } from '../constants/preferences';
import type { SavedChoice } from '../types/preferences';

export function summarize(choice: SavedChoice) {
  if (choice.mode === 'ai') return 'The AI decides everything';
  const { pace, interests, company, cycling } = choice.preferences;
  const parts = [
    pace && PACE_LABELS[pace],
    interests.map((interest) => INTEREST_LABELS[interest]).join(', '),
    company && COMPANY_LABELS[company],
    cycling === true && CYCLING_LABELS.yes,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No preferences picked';
}
