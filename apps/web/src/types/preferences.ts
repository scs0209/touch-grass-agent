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
