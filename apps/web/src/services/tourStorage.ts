import type { TourId } from '../types/tour';

const STORAGE_KEY = 'touch-grass-tours-seen';

function loadSeen(): TourId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export const hasSeenTour = (id: TourId) => loadSeen().includes(id);

/** Finished and skipped count the same: either way the person has seen enough of it. */
export function markTourSeen(id: TourId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set([...loadSeen(), id])]));
  } catch {
    // Private browsing: the tour shows again next visit.
  }
}

/** "How it works" plays the home tour now and the result tour on the next suggestion. */
export function forgetTours() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was saved either.
  }
}
