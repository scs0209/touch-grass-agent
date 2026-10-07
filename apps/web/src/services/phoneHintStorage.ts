const STORAGE_KEY = 'touch-grass-phone-hint-hidden';

export function isPhoneHintHidden() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function hidePhoneHint() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // Private browsing: the tip shows again next visit.
  }
}
