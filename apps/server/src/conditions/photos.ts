import { distanceInMeters, type LatLon } from '../geo.js';

export type ShotKind = 'street' | 'arrival' | 'place';

export interface TripPhoto {
  /** Key for GET /api/trip-photos/:key, which serves the image from this server so the canvas stays untainted. */
  key: string;
  kind: ShotKind;
  source: 'mapillary' | 'wikimedia';
  creator: string;
  license: string;
  capturedAt: string | null;
}

export interface TripPhotos {
  street: TripPhoto[];
  arrival: TripPhoto | null;
  place: TripPhoto[];
}

interface MapillaryImage {
  id: string;
  thumb_2048_url?: string;
  computed_compass_angle?: number;
  compass_angle?: number;
  captured_at?: number;
  is_pano?: boolean;
  sequence?: string;
  creator?: { username?: string };
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
}

interface Candidate {
  /** Mapillary image id or Commons file title. */
  id: string;
  url: string;
  photo: Omit<TripPhoto, 'key'>;
}

const MAPILLARY_FIELDS =
  'id,thumb_2048_url,computed_compass_angle,compass_angle,captured_at,is_pano,sequence,creator,computed_geometry,geometry';
const MAPILLARY_LICENSE = 'CC BY-SA 4.0';
const USER_AGENT = 'touch-grass-agent/1.0 (https://github.com/scs0209/touch-grass-agent)';
/** A search slower than this just leaves that spot without a photo, so one slow answer can't hold up the film. */
const REQUEST_TIMEOUT_MS = 5000;
const PHOTO_TIMEOUT_MS = 7000;

const STREET_SHOTS = 8;
/** Widen only as far as the same neighborhood; farther photos would show other streets. */
const STREET_SEARCH_M = [25, 60, 150];
/** How far a photo may look away from the walking direction and still read as "on the way". */
const MAX_HEADING_OFF = 55;
/** Fewer photos than this along the way and the film falls back to the illustrated preview. */
const MIN_STREET_SHOTS = 4;
const ARRIVAL_SEARCH_M = 50;
const PLACE_SEARCH_M = 150;
const PLACE_SHOTS = 3;
const WIKIMEDIA_RADIUS_M = 400;
/** One of Wikimedia's standard thumbnail widths, which are served from cache instead of rendered on request. */
const WIKIMEDIA_WIDTH = 1920;
/** Words in a park's name that say nothing about which park it is. */
const GENERIC_NAME_WORDS = new Set(['park', 'the', 'of', 'and', 'garden', 'gardens', 'children', 'childrens', 'neighborhood', 'square', 'playground', 'green']);

const IMAGE_TTL_MS = 30 * 60 * 1000;
const imageUrls = new Map<string, { url: string; expiresAt: number }>();

function remember(url: string) {
  const now = Date.now();
  for (const [key, entry] of imageUrls) if (entry.expiresAt <= now) imageUrls.delete(key);
  const key = crypto.randomUUID();
  imageUrls.set(key, { url, expiresAt: now + IMAGE_TTL_MS });
  return key;
}

/**
 * Downloads a photo handed out by getTripPhotos; null when the key is unknown, expired, or the source fails.
 * The whole file is read before answering, so a source that stalls midway fails cleanly instead of
 * leaving the browser waiting on a half-sent image.
 */
export async function fetchTripPhoto(key: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const entry = imageUrls.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  try {
    const response = await fetch(entry.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return { bytes: await response.arrayBuffer(), type: response.headers.get('Content-Type') ?? 'image/jpeg' };
  } catch {
    return null;
  }
}

// ---------- geometry ----------

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function bearing(from: LatLon, to: LatLon) {
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function bbox({ lat, lon }: LatLon, radiusM: number) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(toRad(lat)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((value) => value.toFixed(6)).join(',');
}

/** The point `distance` meters along `path`, and the walking direction there. */
function along(path: LatLon[], cumulative: number[], distance: number) {
  let i = cumulative.findIndex((value) => value >= distance);
  if (i <= 0) i = 1;
  const [a, b] = [path[i - 1], path[i]];
  const part = (distance - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1);
  return {
    point: { lat: a.lat + (b.lat - a.lat) * part, lon: a.lon + (b.lon - a.lon) * part },
    heading: bearing(a, b),
  };
}

// ---------- Mapillary ----------

interface Search {
  token: string;
  /** Aborts when the browser gives up on the request, e.g. the preview was closed. */
  cancel: AbortSignal;
}

const deadline = (cancel: AbortSignal) => AbortSignal.any([cancel, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);

async function searchMapillary({ token, cancel }: Search, center: LatLon, radiusM: number): Promise<MapillaryImage[]> {
  const url = `https://graph.mapillary.com/images?fields=${MAPILLARY_FIELDS}&bbox=${bbox(center, radiusM)}&limit=50`;
  // The token goes in a header so it never shows up in logged or traced URLs.
  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${token}` },
    signal: deadline(cancel),
  });
  if (!response.ok) throw new Error(`Mapillary failed: ${response.status}`);
  const data = (await response.json()) as { data?: MapillaryImage[] };
  return (data.data ?? []).filter((image) => image.thumb_2048_url && !image.is_pano);
}

const imageHeading = (image: MapillaryImage) => image.computed_compass_angle ?? image.compass_angle;
const imagePoint = (image: MapillaryImage): LatLon | null => {
  const coordinates = (image.computed_geometry ?? image.geometry)?.coordinates;
  return coordinates ? { lat: coordinates[1], lon: coordinates[0] } : null;
};

function mapillaryCandidate(image: MapillaryImage, kind: ShotKind): Candidate {
  return {
    id: image.id,
    url: image.thumb_2048_url!,
    photo: {
      kind,
      source: 'mapillary',
      creator: image.creator?.username ?? 'Mapillary contributor',
      license: MAPILLARY_LICENSE,
      capturedAt: image.captured_at ? new Date(image.captured_at).toISOString() : null,
    },
  };
}

/** Lower is better: facing the right way first, then newer photos, then staying on the same capture sequence. */
function score(image: MapillaryImage, heading: number, previousSequence?: string) {
  const facing = angleBetween(imageHeading(image) ?? heading + 180, heading);
  const ageYears = image.captured_at ? (Date.now() - image.captured_at) / (365 * 24 * 3600 * 1000) : 10;
  return facing + ageYears * 4 - (previousSequence && image.sequence === previousSequence ? 15 : 0);
}

function pickFacing(images: MapillaryImage[], heading: number, used: Set<string>, previousSequence?: string) {
  return images
    .filter((image) => !used.has(image.id))
    .filter((image) => {
      const facing = imageHeading(image);
      return facing !== undefined && angleBetween(facing, heading) <= MAX_HEADING_OFF;
    })
    .sort((a, b) => score(a, heading, previousSequence) - score(b, heading, previousSequence))[0];
}

async function streetShots(search: Search, path: LatLon[]): Promise<Candidate[]> {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + distanceInMeters(path[i - 1], path[i]));
  const total = cumulative.at(-1) ?? 0;
  if (total < 50) return [];

  // Skip the doorstep and the last stretch, which the arrival shot covers.
  const spots = Array.from({ length: STREET_SHOTS }, (_, i) => along(path, cumulative, total * (0.05 + (0.85 * i) / (STREET_SHOTS - 1))));
  const found = await Promise.all(
    spots.map(async ({ point, heading }) => {
      let images: MapillaryImage[] = [];
      for (const radius of STREET_SEARCH_M) {
        if (search.cancel.aborted) break;
        images = await searchMapillary(search, point, radius).catch(() => []);
        if (pickFacing(images, heading, new Set())) break;
      }
      return images;
    }),
  );

  const used = new Set<string>();
  const shots: Candidate[] = [];
  let previousSequence: string | undefined;
  spots.forEach(({ heading }, i) => {
    const image = pickFacing(found[i], heading, used, previousSequence);
    if (!image) return;
    used.add(image.id);
    previousSequence = image.sequence;
    shots.push(mapillaryCandidate(image, 'street'));
  });
  return shots;
}

/** A photo taken near where the route meets the park, looking into it. */
function arrivalShot(images: MapillaryImage[], entrance: LatLon, destination: LatLon, used: Set<string>) {
  const image = pickFacing(images, bearing(entrance, destination), used);
  return image ? mapillaryCandidate(image, 'arrival') : null;
}

/** Photos taken inside the park, from different capture runs so they don't all look the same. */
function mapillaryPlaceShots(images: MapillaryImage[], destination: LatLon, used: Set<string>) {
  const sequences = new Set<string>();
  return images
    .filter((image) => !used.has(image.id))
    .map((image) => ({ image, distance: imagePoint(image) ? distanceInMeters(imagePoint(image)!, destination) : Infinity }))
    .sort((a, b) => a.distance - b.distance)
    .filter(({ image }) => {
      if (image.sequence && sequences.has(image.sequence)) return false;
      if (image.sequence) sequences.add(image.sequence);
      return true;
    })
    .slice(0, PLACE_SHOTS)
    .map(({ image }) => mapillaryCandidate(image, 'place'));
}

// ---------- Wikimedia Commons ----------

interface CommonsPage {
  title: string;
  imageinfo?: {
    thumburl?: string;
    mime?: string;
    width?: number;
    height?: number;
    extmetadata?: Record<string, { value?: string } | undefined>;
    commonmetadata?: { name: string; value: unknown }[];
  }[];
}

/** Handheld daylight shots are faster than this; slower ones are night scenes and light trails. */
const MAX_EXPOSURE_SEC = 1 / 30;

function exposureSeconds(page: CommonsPage) {
  const value = page.imageinfo?.[0]?.commonmetadata?.find((entry) => entry.name === 'ExposureTime')?.value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const [top, bottom = '1'] = String(value).split('/');
  const seconds = Number(top) / Number(bottom);
  return Number.isFinite(seconds) ? seconds : null;
}

/** "Statue of X 3 (51270).jpg" and "Statue of X 4 (51271).jpg" are the same shot taken twice. */
const titleStem = (title: string) =>
  title
    .replace(/^File:/, '')
    .replace(/\.[a-z]+$/i, '')
    .replace(/[\d()_\-.,]+/g, ' ')
    .trim()
    .toLowerCase();

const nameWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !GENERIC_NAME_WORDS.has(word));

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Geotagged Commons photos near the park whose title names the park. Photos that only happen to be
 * nearby are skipped, so the film never passes off some other building as this place.
 */
async function wikimediaPlaceShots(destination: LatLon, placeName: string, cancel: AbortSignal): Promise<Candidate[]> {
  const wanted = nameWords(placeName);
  if (wanted.length === 0) return [];

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'geosearch',
    ggscoord: `${destination.lat}|${destination.lon}`,
    ggsradius: String(WIKIMEDIA_RADIUS_M),
    ggslimit: '100',
    ggsnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata|commonmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal',
    iiurlwidth: String(WIKIMEDIA_WIDTH),
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: deadline(cancel),
  });
  if (!response.ok) throw new Error(`Wikimedia failed: ${response.status}`);
  const pages = Object.values(((await response.json()) as { query?: { pages?: Record<string, CommonsPage> } }).query?.pages ?? {});

  const stems = new Set<string>();
  return pages
    .filter((page) => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl || info.mime !== 'image/jpeg' || (info.width ?? 0) < 1200) return false;
      if ((exposureSeconds(page) ?? 0) > MAX_EXPOSURE_SEC) return false;
      const title = new Set(nameWords(page.title));
      if (!wanted.every((word) => title.has(word))) return false;
      const stem = titleStem(page.title);
      if (stems.has(stem)) return false;
      stems.add(stem);
      return true;
    })
    .slice(0, PLACE_SHOTS)
    .map((page) => {
      const info = page.imageinfo![0];
      const meta = info.extmetadata ?? {};
      return {
        id: page.title,
        url: info.thumburl!,
        photo: {
          kind: 'place' as const,
          source: 'wikimedia' as const,
          creator: stripTags(meta.Artist?.value ?? '') || 'Wikimedia Commons contributor',
          license: stripTags(meta.LicenseShortName?.value ?? '') || 'see Wikimedia Commons',
          capturedAt: meta.DateTimeOriginal?.value ? stripTags(meta.DateTimeOriginal.value) : null,
        },
      };
    });
}

// ---------- entry point ----------

const withKey = ({ url, photo }: Candidate): TripPhoto => ({ key: remember(url), ...photo });

/**
 * Real photos for the walk preview: street-level photos along the way there, one at the park's edge,
 * and a few of the park itself. Returns null when there is no Mapillary token or too few photos.
 */
export async function getTripPhotos(
  path: LatLon[],
  destination: LatLon,
  placeName: string,
  cancel: AbortSignal = new AbortController().signal,
): Promise<TripPhotos | null> {
  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token || path.length < 2) return null;

  const search = { token, cancel };
  const entrance = path.at(-1)!;
  const [street, commons, nearEntrance, inPark] = await Promise.all([
    streetShots(search, path),
    wikimediaPlaceShots(destination, placeName, cancel).catch(() => []),
    searchMapillary(search, entrance, ARRIVAL_SEARCH_M).catch(() => []),
    searchMapillary(search, destination, PLACE_SEARCH_M).catch(() => []),
  ]);
  if (street.length < MIN_STREET_SHOTS || cancel.aborted) return null;

  const used = new Set(street.map((shot) => shot.id));
  const arrival = arrivalShot(nearEntrance, entrance, destination, used);
  if (arrival) used.add(arrival.id);
  // Eye-level photos taken in the park show the place itself; Commons photos named after it are often
  // close-ups of a flower or a sign, so they only fill in.
  const place = [...mapillaryPlaceShots(inPark, destination, used), ...commons].slice(0, PLACE_SHOTS);
  if (!arrival && place.length === 0) return null;

  return {
    street: street.map(withKey),
    arrival: arrival ? withKey(arrival) : null,
    place: place.map(withKey),
  };
}
