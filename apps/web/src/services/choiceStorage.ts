import type { SavedChoice } from '../types/preferences';

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
