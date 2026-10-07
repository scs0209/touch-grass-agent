import type { Visit } from '../types/explore';

const STORAGE_KEY = 'touch-grass-visits';
/** Years of weekly walks; each one is a few hundred bytes. */
const MAX_VISITS = 500;

const isVisit = (value: unknown): value is Visit => {
  const visit = value as Visit;
  return (
    typeof visit?.name === 'string' &&
    (visit.kind === 'park' || visit.kind === 'landmark') &&
    Number.isFinite(visit.lat) &&
    Number.isFinite(visit.lon) &&
    Number.isFinite(visit.at)
  );
};

/** Newest first. */
export function loadVisits(): Visit[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(isVisit) : [];
  } catch {
    return [];
  }
}

export function addVisit(visits: Visit[], visit: Visit) {
  const next = [visit, ...visits].slice(0, MAX_VISITS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a full storage keeps the visit for this session only.
  }
  return next;
}
