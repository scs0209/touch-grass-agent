import { fetchTripPhotos, tripPhotoUrl } from '../services/api';
import type { TripPhoto, TripPhotos } from '../types/api';
import type { LatLon } from '../types/geo';
import type { StoryInput } from '../types/preview';
import { bearing, distanceM } from '../utils/geo';
import { clamp01, FONT, wrapLines } from './canvas';
import type { FlyoverMap, MapCamera, MapLook } from './flyoverMap';
import { buildStory, pathThere, type Story } from './story';

export const FILM_WIDTH = 1080;
export const FILM_HEIGHT = 1920;

interface LoadedPhoto {
  photo: TripPhoto;
  image: HTMLCanvasElement;
}

/** Where the camera looks in a photo: zoom past the cover crop, and pan within the spare edges (-1 to 1). */
interface Framing {
  scale: number;
  x: number;
  y: number;
}

interface Caption {
  kicker?: string;
  title: string;
  sub?: string;
}

type MapShotKind = 'opening' | 'route' | 'arrival' | 'things' | 'ending';

interface MapShot {
  view: 'map';
  kind: MapShotKind;
  start: number;
  length: number;
  camera(progress: number): MapCamera;
  /** How far along the way the walker is (0 to 1); null hides the walker. */
  walker(progress: number): number | null;
}

interface PhotoShot {
  view: 'photo';
  photo: TripPhoto;
  image: HTMLCanvasElement;
  start: number;
  length: number;
  from: Framing;
  to: Framing;
}

type Shot = MapShot | PhotoShot;

interface CaptionSpan {
  caption: Caption;
  start: number;
  end: number;
  /** Ending captions sit higher, clear of the end-screen buttons. */
  placement: 'bottom' | 'center';
}

interface Track {
  points: LatLon[];
  cumulative: number[];
  length: number;
}

export interface Film {
  story: Story;
  map: FlyoverMap;
  track: Track;
  shots: Shot[];
  captions: CaptionSpan[];
  credits: string[];
  total: number;
  dispose(): void;
}

/** Shot lengths in beats, so every cut lands on the music. */
const SHOT_BEATS = { opening: 7, route: 14, arrival: 6, thing: 5, photo: 5, ending: 8 };
const MAX_PHOTOS = 4;
const MAX_MAP_THINGS = 3;
const FADE_SEC = 0.35;
/** A photo still loading after this is left out; the server itself gives up on a source after 7 seconds. */
const PHOTO_WAIT_MS = 9000;
/** Past this the film goes ahead without photos of the park. */
const SEARCH_WAIT_MS = 15000;

const MAP_CREDIT = '© OpenStreetMap contributors · OpenFreeMap';
const GREEN = '#34c759';

/** The map renders at half the film size in CSS pixels, doubled for sharpness. */
const VIEW_WIDTH = FILM_WIDTH / 2;
const VIEW_HEIGHT = FILM_HEIGHT / 2;
/** Steeper than this and tall buildings beside the way fill the frame. */
const TRACK_PITCH = 55;
/** Keeps the walker a little below the middle, clear of the captions, with the way ahead in view. */
const TRACK_LIFT = 180;

const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- the way there ----------

const toRad = (deg: number) => (deg * Math.PI) / 180;

function trackOf(points: LatLon[]): Track {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distanceM(points[i - 1], points[i]));
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}

function pointAt({ points, cumulative, length }: Track, distance: number): LatLon {
  const d = Math.min(Math.max(distance, 0), length);
  let i = cumulative.findIndex((value) => value >= d);
  if (i <= 0) i = 1;
  const [a, b] = [points[i - 1], points[i]];
  const part = (d - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1);
  return { lat: lerp(a.lat, b.lat, part), lon: lerp(a.lon, b.lon, part) };
}

/** The walking direction around `distance`, looked at over a stretch so the camera turns smoothly at corners. */
function headingAt(track: Track, distance: number) {
  const ahead = Math.max(120, track.length * 0.08);
  const from = Math.max(0, Math.min(distance - 40, track.length - ahead - 40));
  const a = pointAt(track, from);
  const b = pointAt(track, Math.min(track.length, distance + ahead));
  if (distanceM(a, b) < 1) return bearing(track.points[0], track.points[track.points.length - 1]);
  return bearing(a, b);
}

// ---------- camera moves ----------

const mercatorX = (lon: number) => (lon + 180) / 360;
const mercatorY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2)) / Math.PI) / 2;
const fromMercator = (x: number, y: number): LatLon => ({
  lon: x * 360 - 180,
  lat: (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90,
});

/** Straight down over the whole way, with some margin. */
function overview(track: Track) {
  const xs = track.points.map((point) => mercatorX(point.lon));
  const ys = track.points.map((point) => mercatorY(point.lat));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 80;
  // 512-pixel tiles: the world is 512 × 2^zoom CSS pixels wide.
  const zoom = Math.log2(Math.min((VIEW_WIDTH - 2 * pad) / ((maxX - minX) * 512 || 1e-9), (VIEW_HEIGHT - 2 * pad) / ((maxY - minY) * 512 || 1e-9)));
  return { center: fromMercator((minX + maxX) / 2, (minY + maxY) / 2), zoom: Math.min(Math.max(zoom, 11), 16.5) };
}

/** Longer ways are followed from higher up, so the walker never races across the frame. */
const trackZoom = (track: Track) => Math.min(17, Math.max(15.2, 16.8 - 0.8 * Math.log2(Math.max(track.length, 400) / 1200)));

/**
 * Moves between two cameras like a drone: the center travels fast while zoomed out and slows as it
 * zooms in, so the ground slides across the frame at an even pace.
 */
function fly(a: MapCamera, b: MapCamera, t: number): MapCamera {
  const dz = b.zoom - a.zoom;
  const c = Math.abs(dz) < 0.05 ? t : (1 - 2 ** (-dz * t)) / (1 - 2 ** -dz);
  return {
    center: fromMercator(
      lerp(mercatorX(a.center.lon), mercatorX(b.center.lon), c),
      lerp(mercatorY(a.center.lat), mercatorY(b.center.lat), c),
    ),
    zoom: lerp(a.zoom, b.zoom, t),
    pitch: lerp(a.pitch, b.pitch, t),
    bearing: lerp(a.bearing, b.bearing, t),
    lift: lerp(a.lift, b.lift, t),
  };
}

/** Mostly walking pace, easing in at the start and out at the park. */
const walkerAt = (progress: number) => 0.6 * progress + 0.4 * easeInOutSine(progress);

interface Plan {
  track: Track;
  wide: MapCamera;
  follow(fraction: number, progress: number): MapCamera;
  orbit(progress: number): MapCamera;
  /** Pulls back from wherever the last map shot left the camera. */
  ending(from: MapCamera, progress: number): MapCamera;
}

function plan(track: Track): Plan {
  const view = overview(track);
  const zoom = trackZoom(track);
  const startHeading = headingAt(track, 0);
  const endHeading = headingAt(track, track.length);
  const destination = track.points[track.points.length - 1];
  const wide: MapCamera = { center: view.center, zoom: view.zoom - 0.15, pitch: 35, bearing: startHeading - 25, lift: 0 };

  const follow = (fraction: number, progress: number): MapCamera => ({
    center: pointAt(track, fraction * track.length),
    zoom: zoom - 0.1 + 0.2 * progress,
    pitch: TRACK_PITCH,
    bearing: headingAt(track, fraction * track.length),
    lift: TRACK_LIFT,
  });
  const arrived = follow(1, 1);
  const circled: MapCamera = { center: destination, zoom: Math.max(zoom + 0.6, 17), pitch: 55, bearing: endHeading + 70, lift: 120 };
  const orbit = (progress: number): MapCamera => {
    // Past the arrival shot, keep circling slowly for the things to do.
    if (progress <= 1) return fly(arrived, circled, easeInOutSine(progress));
    return { ...circled, bearing: circled.bearing + 25 * (progress - 1) };
  };
  const ending = (from: MapCamera, progress: number): MapCamera => {
    const to: MapCamera = { ...wide, zoom: view.zoom - 0.1, pitch: 30, bearing: from.bearing + 25 };
    if (progress < 0.7) return fly(from, to, easeInOutSine(progress / 0.7));
    return { ...to, zoom: to.zoom - 0.15 * ((progress - 0.7) / 0.3) };
  };
  return { track, wide, follow, orbit, ending };
}

/** Cameras worth caching tiles for: the wide view, every stretch of the way, and the park. */
function warmUpStops({ wide, follow, orbit, ending }: Plan) {
  return [wide, ...Array.from({ length: 11 }, (_, i) => follow(i / 10, i / 10)), orbit(1), ending(orbit(1), 1)];
}

function lookFor(input: StoryInput): MapLook {
  const { isDay, minutesUntilSunset, sky } = input.conditions;
  if (!isDay) return { sky: '#0b1633', horizon: '#2b3d63', fog: '#1c2846', buildings: '#8a90a6' };
  if (minutesUntilSunset > 0 && minutesUntilSunset <= 60) {
    return { sky: '#e9925a', horizon: '#ffd2a1', fog: '#f4d8be', buildings: '#efd5b8' };
  }
  if (['cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder'].includes(sky)) {
    return { sky: '#9aa7b4', horizon: '#d5dbe0', fog: '#dfe3e6', buildings: '#d9d8d4' };
  }
  return { sky: '#6fb2ea', horizon: '#d6e9f7', fog: '#e6eef4', buildings: '#ece4d6' };
}

// ---------- loading ----------

function searchParkPhotos(input: StoryInput, there: LatLon[], signal: AbortSignal): Promise<TripPhotos | null> {
  // pathThere ends at the park itself; the point before is where the route meets the park.
  const entrance = input.route ? there[there.length - 2] : input.destination;
  return fetchTripPhotos(
    { entrance, destination: input.destination, placeName: input.placeName },
    AbortSignal.any([signal, AbortSignal.timeout(SEARCH_WAIT_MS)]),
  );
}

/** Color grade once at load, so each frame only copies pixels. */
function grade(image: HTMLImageElement, input: StoryInput) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  const gloomy = ['cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder'].includes(input.conditions.sky);
  ctx.filter = gloomy ? 'saturate(0.78) contrast(1.04) brightness(0.96)' : 'saturate(0.9) contrast(1.06) brightness(1.01)';
  ctx.drawImage(image, 0, 0);
  return canvas;
}

async function loadPhoto(photo: TripPhoto, input: StoryInput, signal: AbortSignal): Promise<LoadedPhoto> {
  signal.throwIfAborted();
  const image = new Image();
  image.src = tripPhotoUrl(photo.key);
  const tooSlow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Photo too slow')), PHOTO_WAIT_MS));
  const stopped = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
  await Promise.race([image.decode(), tooSlow, stopped]);
  return { photo, image: grade(image, input) };
}

/** Real photos of the park, the one at its edge first; empty when there are none. */
async function loadParkPhotos(input: StoryInput, there: LatLon[], signal: AbortSignal): Promise<LoadedPhoto[]> {
  const photos = await searchParkPhotos(input, there, signal).catch(() => null);
  if (!photos || signal.aborted) return [];
  const all = [...(photos.arrival ? [photos.arrival] : []), ...photos.place].slice(0, MAX_PHOTOS);
  const loaded = await Promise.all(all.map((photo) => loadPhoto(photo, input, signal).catch(() => null)));
  return loaded.filter((photo) => photo !== null);
}

/**
 * Builds the 3D flyover of the way to the park, ending on real photos of it when there are any.
 * Null when the map can't be shown (no WebGL, or the map tiles are unreachable).
 */
export async function loadFilm(input: StoryInput, bpm: number, signal: AbortSignal): Promise<Film | null> {
  const there = pathThere(input);
  const camera = plan(trackOf(there));
  // Without the map there is no film, so its failure stops the photo search too.
  const noMap = new AbortController();
  const [map, photos] = await Promise.all([
    import('./flyoverMap')
      .then(({ openFlyoverMap }) =>
        openFlyoverMap({ path: there, width: FILM_WIDTH, height: FILM_HEIGHT, look: lookFor(input), stops: warmUpStops(camera), signal }),
      )
      .catch(() => {
        noMap.abort();
        return null;
      }),
    loadParkPhotos(input, there, AbortSignal.any([signal, noMap.signal])),
  ]);
  if (!map) return null;
  if (signal.aborted) {
    map.dispose();
    return null;
  }
  return buildFilm(input, bpm, map, camera, photos);
}

// ---------- the cut ----------

function walkCaption(input: StoryInput): Caption {
  const byBike = input.bikeStation !== null;
  const { route } = input;
  const there = route ? Math.round(route.durationMin / 2) : Math.round(input.durationMin / 2);
  const km = route ? (route.distanceM / 2000).toFixed(1) : null;
  return {
    kicker: byBike ? `By bike from ${input.bikeStation?.name}` : 'On foot',
    title: `On the way to ${input.placeName}`,
    sub: km ? `${km} km · about ${there} min there` : `About ${there} min there`,
  };
}

function creditsFor(photos: TripPhoto[]) {
  const lines = [`Map: ${MAP_CREDIT}`];
  const street = [...new Set(photos.filter((photo) => photo.source === 'mapillary').map((photo) => photo.creator))];
  if (street.length > 0) {
    const names = street.length > 3 ? `${street.slice(0, 3).join(', ')} and others` : street.join(', ');
    lines.push(`Photos: ${names} on Mapillary, CC BY-SA 4.0`);
  }
  const commons = photos.filter((photo) => photo.source === 'wikimedia');
  for (const photo of new Map(commons.map((p) => [p.creator + p.license, p])).values()) {
    lines.push(`Photo: ${photo.creator}, ${photo.license}, via Wikimedia Commons`);
  }
  return lines;
}

function buildFilm(input: StoryInput, bpm: number, map: FlyoverMap, camera: Plan, photos: LoadedPhoto[]): Film {
  const story = buildStory(input, bpm);
  const beat = 60 / bpm;
  const shots: Shot[] = [];
  const captions: CaptionSpan[] = [];
  let start = 0;

  const addMap = (kind: MapShotKind, beats: number, move: (p: number) => MapCamera, walker: (p: number) => number | null) => {
    const shot: MapShot = { view: 'map', kind, start, length: beats * beat, camera: move, walker };
    shots.push(shot);
    start += shot.length;
    return shot;
  };
  const caption = (shot: { start: number; length: number }, text: Caption, placement: CaptionSpan['placement'] = 'bottom') =>
    captions.push({ caption: text, start: shot.start, end: shot.start + shot.length, placement });

  // Establishing shot over the whole way, then down to street level where the walk starts.
  const startCamera = camera.follow(0, 0);
  const drift: MapCamera = { ...camera.wide, zoom: camera.wide.zoom + 0.25, pitch: 40, bearing: camera.wide.bearing + 10 };
  const opening = addMap(
    'opening',
    SHOT_BEATS.opening,
    (p) => (p < 0.4 ? fly(camera.wide, drift, easeInOutSine(p / 0.4)) : fly(drift, startCamera, easeInOutSine((p - 0.4) / 0.6))),
    (p) => (p < 0.4 ? null : 0),
  );
  const dress = input.outfitItems.slice(0, 3).map((item) => item.label.toLowerCase());
  caption(opening, {
    kicker: `${Math.round(input.conditions.temperatureC)}° · ${input.conditions.description} right now`,
    title: `Your next ${input.durationMin} minutes`,
    sub: dress.length > 0 ? `Dress for ${Math.round(input.conditions.feelsLikeC)}°: ${dress.join(', ')}` : undefined,
  });

  // Tracking shot behind the walker, all the way to the park.
  const route = addMap('route', SHOT_BEATS.route, (p) => camera.follow(walkerAt(p), p), walkerAt);
  caption(route, walkCaption(input));

  const arrival = addMap('arrival', SHOT_BEATS.arrival, camera.orbit, () => null);
  caption(arrival, { kicker: "You've arrived", title: input.placeName });

  if (photos.length > 0) {
    photos.forEach(({ photo, image }, i) => {
      const pan = i % 2 ? -0.7 : 0.7;
      const shot: PhotoShot = {
        view: 'photo',
        photo,
        image,
        start,
        length: SHOT_BEATS.photo * beat,
        from: { scale: 1.1, x: -pan, y: 0 },
        to: { scale: 1.12, x: pan, y: 0 },
      };
      shots.push(shot);
      start += shot.length;
      const thing = input.things[i];
      caption(
        shot,
        thing
          ? { kicker: `Once you're there · ${i + 1}/${Math.min(input.things.length, photos.length)}`, title: thing.text }
          : { kicker: "Once you're there", title: input.placeName },
      );
    });
  } else {
    // No photos: keep circling the park while the things to do come up one by one.
    const things = input.things.slice(0, MAX_MAP_THINGS);
    if (things.length > 0) {
      const each = SHOT_BEATS.thing * beat;
      const circling = addMap('things', SHOT_BEATS.thing * things.length, (p) => camera.orbit(1 + p * things.length), () => null);
      things.forEach((thing, i) =>
        caption(
          { start: circling.start + i * each, length: each },
          { kicker: `Once you're there · ${i + 1}/${things.length}`, title: thing.text },
        ),
      );
    }
  }

  // Pull back up over the whole way, so the park reads as part of the neighborhood.
  const previous = shots[shots.length - 1];
  const from = previous.view === 'map' ? previous.camera(1) : camera.orbit(1);
  const ending = addMap('ending', SHOT_BEATS.ending, (p) => camera.ending(from, p), () => null);
  caption(
    ending,
    {
      title: 'Ready when you are.',
      sub: `Leave now · back by ${story.backBy}${story.sunsetAt ? ` · sunset ${story.sunsetAt}` : ''}`,
    },
    'center',
  );

  return {
    story,
    map,
    track: camera.track,
    shots,
    captions,
    credits: creditsFor(photos.map(({ photo }) => photo)),
    total: start,
    dispose: () => map.dispose(),
  };
}

// ---------- drawing ----------

/** A slight drift, like a camera held by someone walking; stays inside the extra zoom. */
function handheld(t: number) {
  return {
    x: 5 * Math.sin(t * 0.9) + 2.5 * Math.sin(t * 2.3 + 1),
    y: 4 * Math.sin(t * 1.1 + 2) + 2 * Math.sin(t * 2.9),
    rotate: 0.0025 * Math.sin(t * 0.7),
  };
}

function drawPhotoShot(ctx: CanvasRenderingContext2D, shot: PhotoShot, progress: number, t: number, still: boolean) {
  const { image } = shot;
  const p = easeInOutSine(clamp01(still ? 0.5 : progress));
  const view = { scale: lerp(shot.from.scale, shot.to.scale, p), x: lerp(shot.from.x, shot.to.x, p), y: lerp(shot.from.y, shot.to.y, p) };
  const cover = Math.max(FILM_WIDTH / image.width, FILM_HEIGHT / image.height) * view.scale;
  const width = image.width * cover;
  const height = image.height * cover;
  const spareX = (width - FILM_WIDTH) / 2;
  const spareY = (height - FILM_HEIGHT) / 2;
  const sway = still ? { x: 0, y: 0, rotate: 0 } : handheld(t);

  ctx.save();
  ctx.translate(FILM_WIDTH / 2 + sway.x, FILM_HEIGHT / 2 + sway.y);
  ctx.rotate(sway.rotate);
  ctx.drawImage(image, -width / 2 + spareX * view.x * 0.9, -height / 2 + spareY * view.y * 0.9, width, height);
  ctx.restore();
}

const onScreen = ({ x, y }: { x: number; y: number }, margin: number) =>
  Number.isFinite(x) && Number.isFinite(y) && x > -margin && x < FILM_WIDTH + margin && y > -margin && y < FILM_HEIGHT + margin;

/** Points far behind the camera can project onto the screen mirrored; this keeps them off it. */
function inFront(camera: MapCamera, point: LatLon) {
  const away = distanceM(camera.center, point);
  if (away < 300) return true;
  const off = Math.abs(((bearing(camera.center, point) - camera.bearing + 540) % 360) - 180);
  return off < 100;
}

function drawHome(ctx: CanvasRenderingContext2D, at: { x: number; y: number }) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(at.x, at.y, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#2a6fdb';
  ctx.beginPath();
  ctx.arc(at.x, at.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A location puck with a beam pointing the way, like a phone's map. */
function drawWalker(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, toward: { x: number; y: number }, t: number) {
  const angle = Math.atan2(toward.y - at.y, toward.x - at.x);
  ctx.save();
  const beam = ctx.createRadialGradient(at.x, at.y, 10, at.x, at.y, 110);
  beam.addColorStop(0, 'rgba(52, 199, 89, 0.55)');
  beam.addColorStop(1, 'rgba(52, 199, 89, 0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.arc(at.x, at.y, 110, angle - 0.45, angle + 0.45);
  ctx.closePath();
  ctx.fill();

  const breathe = 0.5 + 0.5 * Math.sin(t * 3);
  ctx.fillStyle = `rgba(52, 199, 89, ${0.18 + 0.12 * breathe})`;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 34 + 8 * breathe, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(at.x, at.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, t: number, still: boolean) {
  ctx.save();
  // Ripples on the ground, flattened as if lying on the tilted map.
  const ripple = still ? 0.4 : (t * 0.8) % 1;
  ctx.strokeStyle = `rgba(52, 199, 89, ${0.7 * (1 - ripple)})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, 20 + 60 * ripple, (20 + 60 * ripple) * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = GREEN;
  const head = { x: at.x, y: at.y - 62 };
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.bezierCurveTo(at.x - 14, at.y - 26, head.x - 30, head.y + 16, head.x - 30, head.y);
  ctx.arc(head.x, head.y, 30, Math.PI, 0);
  ctx.bezierCurveTo(head.x + 30, head.y + 16, at.x + 14, at.y - 26, at.x, at.y);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(head.x, head.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMapShot(ctx: CanvasRenderingContext2D, film: Film, shot: MapShot, progress: number, t: number, still: boolean) {
  const p = still ? 0.5 : clamp01(progress);
  const camera = shot.camera(p);
  const walker = shot.walker(p);
  const traveled = shot.kind === 'opening' ? 0 : (walker ?? 1);
  ctx.drawImage(film.map.render(camera, traveled), 0, 0, FILM_WIDTH, FILM_HEIGHT);

  const { track } = film;
  const home = track.points[0];
  const destination = track.points[track.points.length - 1];
  if ((shot.kind === 'opening' || shot.kind === 'ending') && inFront(camera, home)) {
    const at = film.map.project(home);
    if (onScreen(at, 40)) drawHome(ctx, at);
  }
  if (inFront(camera, destination)) {
    const at = film.map.project(destination);
    if (onScreen(at, 80)) drawPin(ctx, at, t, still);
  }
  if (walker !== null) {
    const distance = walker * track.length;
    const at = film.map.project(pointAt(track, distance));
    const toward = film.map.project(pointAt(track, Math.min(distance + 25, track.length)));
    const pointing = Math.hypot(toward.x - at.x, toward.y - at.y) > 2 ? toward : { x: at.x, y: at.y - 10 };
    if (onScreen(at, 40)) drawWalker(ctx, at, pointing, t);
  }
}

function drawLight(ctx: CanvasRenderingContext2D, story: Story) {
  const { isDay, minutesUntilSunset } = story.input.conditions;
  ctx.save();
  if (!isDay) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(40, 60, 110, 0.55)';
    ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  } else if (minutesUntilSunset > 0 && minutesUntilSunset <= 60) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255, 160, 80, 0.45)';
    ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    FILM_WIDTH / 2,
    FILM_HEIGHT / 2,
    FILM_HEIGHT * 0.3,
    FILM_WIDTH / 2,
    FILM_HEIGHT / 2,
    FILM_HEIGHT * 0.75,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
}

interface Line {
  text: string;
  size: number;
  weight: number;
  alpha: number;
  gapAfter: number;
}

function captionLines(ctx: CanvasRenderingContext2D, caption: Caption): Line[] {
  const maxWidth = FILM_WIDTH - 160;
  const lines: Line[] = [];
  const add = (text: string, size: number, weight: number, alpha: number, maxLines: number, gapAfter: number) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const wrapped = wrapLines(ctx, text, maxWidth).slice(0, maxLines);
    wrapped.forEach((part, i) => lines.push({ text: part, size, weight, alpha, gapAfter: i === wrapped.length - 1 ? gapAfter : size * 0.18 }));
  };
  if (caption.kicker) add(caption.kicker.toUpperCase(), 30, 600, 0.82, 1, 18);
  add(caption.title, 72, 700, 1, 3, 20);
  if (caption.sub) add(caption.sub, 36, 500, 0.9, 2, 0);
  return lines;
}

function drawCaption(ctx: CanvasRenderingContext2D, span: CaptionSpan, t: number, still: boolean) {
  const fadeIn = still ? 1 : clamp01((t - span.start - 0.15) / 0.5);
  const fadeOut = still ? 1 : clamp01((span.end - t) / 0.35);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;

  const lines = captionLines(ctx, span.caption);
  const height = lines.reduce((sum, line) => sum + line.size + line.gapAfter, 0);
  const rise = (1 - easeInOutSine(fadeIn)) * 24;
  let y = (span.placement === 'center' ? FILM_HEIGHT * 0.36 - height / 2 : FILM_HEIGHT - 260 - height) + rise;

  if (span.placement === 'bottom') {
    const scrim = ctx.createLinearGradient(0, FILM_HEIGHT - 300 - height - 200, 0, FILM_HEIGHT);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    scrim.addColorStop(1, `rgba(0, 0, 0, ${0.62 * alpha})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, FILM_HEIGHT - 300 - height - 200, FILM_WIDTH, 500 + height);
  } else {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * alpha})`;
    ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  }

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 2;
  for (const line of lines) {
    ctx.font = `${line.weight} ${line.size}px ${FONT}`;
    ctx.fillStyle = `rgba(255, 255, 255, ${line.alpha * alpha})`;
    ctx.fillText(line.text, 80, y);
    y += line.size + line.gapAfter;
  }
  ctx.restore();
}

function sourceLabel(shot: Shot) {
  if (shot.view === 'map') return MAP_CREDIT;
  const year = shot.photo.capturedAt?.match(/\d{4}/)?.[0];
  return `${shot.photo.source === 'mapillary' ? 'Mapillary' : 'Wikimedia Commons'}${year ? ` · ${year}` : ''}`;
}

function drawSourceTag(ctx: CanvasRenderingContext2D, label: string) {
  ctx.save();
  ctx.font = `500 24px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(label, FILM_WIDTH - 48, FILM_HEIGHT - 40);
  ctx.restore();
}

function drawCredits(ctx: CanvasRenderingContext2D, film: Film, alpha: number) {
  ctx.save();
  ctx.font = `500 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
  // Below the preview's close and mute buttons.
  let y = 280;
  for (const credit of film.credits) {
    for (const line of wrapLines(ctx, credit, FILM_WIDTH - 160).slice(0, 2)) {
      ctx.fillText(line, FILM_WIDTH / 2, y);
      y += 34;
    }
    y += 8;
  }
  ctx.restore();
}

function drawProgress(ctx: CanvasRenderingContext2D, progress: number) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.roundRect(60, 42, FILM_WIDTH - 120, 6, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.roundRect(60, 42, (FILM_WIDTH - 120) * progress, 6, 3);
  ctx.fill();
}

function drawShot(ctx: CanvasRenderingContext2D, film: Film, shot: Shot, t: number, still: boolean) {
  const progress = (t - shot.start) / shot.length;
  if (shot.view === 'map') drawMapShot(ctx, film, shot, progress, t, still);
  else drawPhotoShot(ctx, shot, progress, t, still);
}

export function drawFilmFrame(ctx: CanvasRenderingContext2D, film: Film, t: number, still: boolean) {
  const found = film.shots.findIndex((candidate) => t < candidate.start + candidate.length);
  const index = found === -1 ? film.shots.length - 1 : found;
  const shot = film.shots[index];
  const next = film.shots[index + 1];
  const end = shot.start + shot.length;
  // Map shots flow into each other as one camera move; cuts to and from photos crossfade.
  const fade = next && (shot.view === 'photo' || next.view === 'photo') ? Math.min(FADE_SEC, shot.length * 0.3) : 0;
  const fading = !still && fade > 0 && t > end - fade;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  drawShot(ctx, film, shot, t, still);
  if (fading) {
    ctx.globalAlpha = (t - (end - fade)) / fade;
    drawShot(ctx, film, next, t, still);
    ctx.globalAlpha = 1;
  }
  drawLight(ctx, film.story);

  drawSourceTag(ctx, sourceLabel(fading ? next : shot));
  for (const span of film.captions) {
    if (t >= span.start && t <= span.end) drawCaption(ctx, span, t, still);
  }
  if (shot.view === 'map' && shot.kind === 'ending') drawCredits(ctx, film, still ? 1 : clamp01((t - shot.start - 0.6) / 0.6));
  drawProgress(ctx, Math.min(t / film.total, 1));
  ctx.restore();
}
