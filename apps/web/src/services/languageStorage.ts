import type { Language } from '../types/language';

const STORAGE_KEY = 'touch-grass-language';

/** Null until the person picks a language; the browser's language is used until then. */
export function loadLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'ko' ? saved : null;
  } catch {
    return null;
  }
}

export function saveLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private browsing: the browser's language is used again next visit.
  }
}
