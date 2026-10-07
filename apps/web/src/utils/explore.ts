import { messages } from '../i18n';
import type { PlaceKind } from '../types/api';
import type { Badge, ExploreStats, Mission, Visit } from '../types/explore';
import type { LatLon, NamedPoint } from '../types/geo';
import type { RecentPlace } from '../types/places';
import { distanceM } from './geo';
import { isSamePlace } from './places';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Close enough to count as being there, measured to the place's center or to where the route meets it. */
const CHECK_IN_RADIUS_M = 300;
/** A phone under trees or between buildings is often a few dozen meters off; worse readings get no extra slack. */
const MAX_ACCURACY_SLACK_M = 100;
/** Places explored farther than this from a starting point don't matter to suggestions there. */
const NEARBY_EXPLORED_M = 50_000;
/** The server takes at most this many explored names. */
const MAX_EXPLORED_NAMES = 200;
const WEEKLY_GOAL = 3;
const CITY_GOAL = 3;
const STREAK_BADGE_WEEKS = 3;

type PlaceInfo = NamedPoint & { kind: PlaceKind; city: string | null };

function startOfDay(ms: number) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Weeks start on Monday, in local time. */
function startOfWeek(ms: number) {
  const day = new Date(startOfDay(ms));
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

const previousWeek = (weekStart: number) => startOfWeek(weekStart - 1);

/** Each place once, at its first check-in, oldest first; visits are stored newest first. */
function firstVisits(visits: Visit[]) {
  const places: Visit[] = [];
  for (const visit of [...visits].reverse()) {
    if (!places.some((place) => isSamePlace(place, visit))) places.push(visit);
  }
  return places;
}

const citiesOf = (visits: Visit[]) => new Set(visits.flatMap((visit) => (visit.city ? [visit.city] : [])));

function placesPerCity(places: Visit[]) {
  const counts = new Map<string, number>();
  for (const { city } of places) if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  return counts;
}

/** Different places checked in at in each week, keyed by the week's Monday. */
function placesPerWeek(visits: Visit[]) {
  const byWeek = new Map<number, Visit[]>();
  for (const visit of visits) {
    const week = startOfWeek(visit.at);
    byWeek.set(week, [...(byWeek.get(week) ?? []), visit]);
  }
  return new Map([...byWeek].map(([week, inWeek]) => [week, firstVisits(inWeek).length]));
}

function longestStreak(weeks: Set<number>) {
  let longest = 0;
  for (const week of weeks) {
    if (weeks.has(previousWeek(week))) continue;
    let length = 0;
    for (let next = week; weeks.has(next); next = startOfWeek(next + 8 * DAY_MS)) length++;
    longest = Math.max(longest, length);
  }
  return longest;
}

export function exploreStats(visits: Visit[], now = Date.now()): ExploreStats {
  const weeks = placesPerWeek(visits);
  const thisWeek = startOfWeek(now);
  const lastWeek = previousWeek(thisWeek);
  // A streak stays alive through the current week until it ends without a check-in.
  let week = weeks.has(thisWeek) ? thisWeek : lastWeek;
  let weekStreak = 0;
  for (; weeks.has(week); week = previousWeek(week)) weekStreak++;
  return {
    places: firstVisits(visits).length,
    cities: citiesOf(visits).size,
    weekStreak,
    thisWeek: weeks.get(thisWeek) ?? 0,
    lastWeek: weeks.get(lastWeek) ?? 0,
    bestWeek: Math.max(0, ...weeks.values()),
  };
}

/** Goals that are only reached by going somewhere; check-ins happen on site. */
export function missions(visits: Visit[], now = Date.now()): Mission[] {
  const t = messages().explore.missions;
  const places = firstVisits(visits);
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const mostInOneCity = Math.max(0, ...placesPerCity(places).values());
  return [
    {
      id: 'today',
      title: t.today,
      progress: Math.min(1, visits.filter((visit) => visit.at >= today).length),
      goal: 1,
      repeats: true,
    },
    {
      id: 'week',
      title: t.week(WEEKLY_GOAL),
      progress: Math.min(WEEKLY_GOAL, places.filter((place) => place.at >= week).length),
      goal: WEEKLY_GOAL,
      repeats: true,
    },
    {
      id: 'city',
      title: t.city(CITY_GOAL),
      progress: Math.min(CITY_GOAL, mostInOneCity),
      goal: CITY_GOAL,
      repeats: false,
    },
    {
      id: 'cities',
      title: t.cities,
      progress: Math.min(2, citiesOf(visits).size),
      goal: 2,
      repeats: false,
    },
    {
      id: 'kinds',
      title: t.kinds,
      progress: new Set(places.map((place) => place.kind)).size,
      goal: 2,
      repeats: false,
    },
  ];
}

export const isDone = (mission: Mission) => mission.progress >= mission.goal;

export function badges(visits: Visit[]): Badge[] {
  const t = messages().explore.badges;
  const places = firstVisits(visits);
  const cities = [...citiesOf(visits)];
  const localCity = [...placesPerCity(places)].find(([, count]) => count >= CITY_GOAL)?.[0];
  const streak = longestStreak(new Set(placesPerWeek(visits).keys()));
  const earned: (Badge | false)[] = [
    places.length >= 1 && { id: 'first', title: t.first, detail: t.firstDetail(places[0].name) },
    places.length >= 5 && { id: 'five', title: t.five, detail: t.fiveDetail },
    places.length >= 10 && { id: 'ten', title: t.ten, detail: t.tenDetail },
    new Set(places.map((place) => place.kind)).size >= 2 && { id: 'kinds', title: t.kinds, detail: t.kindsDetail },
    localCity !== undefined && { id: 'local', title: t.local, detail: t.localDetail(CITY_GOAL, localCity) },
    cities.length >= 2 && { id: 'cities', title: t.cities, detail: cities.join(', ') },
    streak >= STREAK_BADGE_WEEKS && {
      id: 'streak',
      title: t.streak(STREAK_BADGE_WEEKS),
      detail: t.streakDetail(STREAK_BADGE_WEEKS),
    },
  ];
  return earned.filter((badge): badge is Badge => badge !== false);
}

/** What makes this place worth the trip for this person, or null when they've been there. */
export function discoveryLabel(visits: Visit[], place: PlaceInfo) {
  const t = messages().explore.discovery;
  if (visits.some((visit) => isSamePlace(visit, place))) return null;
  if (visits.length === 0) return t.first;
  if (!visits.some((visit) => visit.kind === place.kind)) return t.firstKind(place.kind);
  if (place.city && !visits.some((visit) => visit.city === place.city)) return t.firstIn(place.city);
  return t.new;
}

export const lastVisit = (visits: Visit[], place: NamedPoint) => visits.find((visit) => isSamePlace(visit, place));

/** Lasting goals before this week's, and today's last, since any check-in counts toward it. */
const missionWeight = (mission: Mission) => {
  if (!mission.repeats) return 0;
  return mission.id === 'today' ? 2 : 1;
};

/** The mission that checking in here would move forward, preferring one it would complete. */
export function missionFor(visits: Visit[], place: PlaceInfo & { area?: string | null }, now = Date.now()) {
  const before = missions(visits, now);
  const after = missions([{ area: null, ...place, at: now }, ...visits], now);
  const advanced = after
    .filter((mission, i) => mission.progress > before[i].progress)
    .sort((a, b) => Number(isDone(b)) - Number(isDone(a)) || missionWeight(a) - missionWeight(b));
  return advanced[0] ?? null;
}

/** What a check-in just did; lasting missions show up as their badges, so only repeating ones are listed as done. */
export function arrivalSummary(before: Visit[], visit: Visit) {
  const after = [visit, ...before];
  const was = missions(before, visit.at);
  const now = missions(after, visit.at);
  const known = new Set(badges(before).map((badge) => badge.id));
  return {
    discovery: discoveryLabel(before, visit),
    lastVisit: lastVisit(before, visit) ?? null,
    finished: now.filter((mission, i) => mission.repeats && isDone(mission) && !isDone(was[i])),
    advanced: now.find((mission, i) => !isDone(mission) && mission.progress > was[i].progress) ?? null,
    newBadges: badges(after).filter((badge) => !known.has(badge.id)),
  };
}

export type ArrivalSummary = ReturnType<typeof arrivalSummary>;

/** "Seoul Forest", "Seoul Forest or Naksan Park", or "Seoul Forest or 2 other places". */
export function candidateNames(candidates: RecentPlace[]) {
  const t = messages().checkIn;
  const [first, second, ...rest] = candidates;
  if (!second) return first?.name ?? '';
  if (rest.length === 0) return t.namesTwo(first.name, second.name);
  return t.namesMany(first.name, rest.length + 1);
}

/** The line under the place name on arrival. */
export function arrivalLine({ discovery, lastVisit }: ArrivalSummary) {
  const t = messages().explore;
  if (discovery) return discovery;
  return lastVisit ? t.backAgainSince(visitDate(lastVisit.at)) : t.backAgain;
}

export const describeStats = (stats: ExploreStats) => messages().explore.stats(stats);

/** The line under a suggested place: what going there would be for the person, or when they were last there. */
export function placeNote(visits: Visit[], place: PlaceInfo) {
  const t = messages().explore;
  const discovery = discoveryLabel(visits, place);
  if (!discovery) {
    const last = lastVisit(visits, place);
    return last ? t.exploredOn(visitDate(last.at)) : null;
  }
  const mission = missionFor(visits, place);
  if (!mission) return discovery;
  return t.missionNote(discovery, isDone(mission), mission.title);
}

/** Today's suggestions without a check-in since they were suggested. */
export function checkInCandidates(recent: RecentPlace[], visits: Visit[], now = Date.now()) {
  return recent.filter(
    (place) =>
      now - place.viewedAt < DAY_MS && !visits.some((visit) => isSamePlace(visit, place) && visit.at >= place.viewedAt),
  );
}

/** The candidate nearest to where the person is, measured to its center or to where its route meets it. */
export function nearestCandidate(position: LatLon, candidates: RecentPlace[]) {
  const measured = candidates.map((place) => ({
    place,
    distanceM: Math.min(distanceM(position, place), place.arrival ? distanceM(position, place.arrival) : Infinity),
  }));
  return measured.sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;
}

export const isThere = (distance: number, accuracyM: number) =>
  distance - Math.min(accuracyM, MAX_ACCURACY_SLACK_M) <= CHECK_IN_RADIUS_M;

/** Names of places explored around a starting point, so the server can put new ones first. */
export function exploredNear(visits: Visit[], origin: LatLon) {
  const names = visits.filter((visit) => distanceM(visit, origin) < NEARBY_EXPLORED_M).map((visit) => visit.name);
  return [...new Set(names)].slice(0, MAX_EXPLORED_NAMES);
}

/** In the app's language rather than the browser's, e.g. "Oct 7" or "10월 7일". */
export const visitDate = (ms: number) =>
  new Date(ms).toLocaleDateString(messages().locale, { month: 'short', day: 'numeric' });
