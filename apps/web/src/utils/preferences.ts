import { messages } from '../i18n';
import type { SavedChoice } from '../types/preferences';

export function summarize(choice: SavedChoice) {
  const t = messages().preferences;
  if (choice.mode === 'ai') return t.ai;
  const { pace, interests, company, cycling } = choice.preferences;
  const parts = [
    pace && t.pace[pace],
    interests.map((interest) => t.interests[interest]).join(', '),
    company && t.company[company],
    cycling === true && t.cycling.yes,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : t.none;
}
