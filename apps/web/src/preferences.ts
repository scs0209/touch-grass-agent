/** Must match preferencesSchema in apps/server/src/schema.ts. */
export type Pace = 'easy' | 'active' | 'workout';
export type Interest = 'greenery' | 'quiet' | 'views' | 'exercise' | 'water';
export type Company = 'alone' | 'kids' | 'dog' | 'friends';

export interface Preferences {
  pace: Pace | null;
  interests: Interest[];
  company: Company | null;
  cycling: boolean | null;
}

/** What the person chose on the questionnaire; "ai" means no preferences, the AI decides freely. */
export type SavedChoice = { mode: 'ai' } | { mode: 'custom'; preferences: Preferences };

export const PACE_LABELS: Record<Pace, string> = {
  easy: 'Easy and relaxed',
  active: 'A bit active',
  workout: 'Get my heart rate up',
};

export const INTEREST_LABELS: Record<Interest, string> = {
  greenery: 'Greenery',
  quiet: 'Quiet spots',
  views: 'Views and photos',
  exercise: 'Exercise',
  water: 'Water',
};

export const COMPANY_LABELS: Record<Company, string> = {
  alone: 'Just me',
  kids: 'With kids',
  dog: 'With a dog',
  friends: 'With friends',
};

export const CYCLING_LABELS = { yes: 'Happy to ride a bike', no: 'Walking only' };

export const EMPTY_PREFERENCES: Preferences = { pace: null, interests: [], company: null, cycling: null };

const STORAGE_KEY = 'touch-grass-preferences';

export function loadChoice(): SavedChoice | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as SavedChoice) : null;
  } catch {
    return null;
  }
}

export function saveChoice(choice: SavedChoice) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
}

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
