import { useSyncExternalStore } from 'react';
import { loadLanguage, saveLanguage } from '../services/languageStorage';
import type { Language } from '../types/language';
import { en, type Messages } from './en';
import { ko } from './ko';

const MESSAGES: Record<Language, Messages> = { en, ko };

const inBrowser = typeof document !== 'undefined';

function browserLanguage(): Language {
  if (!inBrowser) return 'en';
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith('ko')) ? 'ko' : 'en';
}

let current: Language = loadLanguage() ?? browserLanguage();
const listeners = new Set<() => void>();
if (inBrowser) document.documentElement.lang = current;

export const currentLanguage = () => current;

/** The words for the current language; read at call time, so code outside React follows a switch too. */
export const messages = () => MESSAGES[current];

export function setLanguage(language: Language) {
  current = language;
  saveLanguage(language);
  if (inBrowser) document.documentElement.lang = language;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the component when the language changes. */
export function useMessages() {
  return MESSAGES[useSyncExternalStore(subscribe, currentLanguage)];
}

export function useLanguage() {
  return [useSyncExternalStore(subscribe, currentLanguage), setLanguage] as const;
}
