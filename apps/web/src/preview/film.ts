import { messages } from '../i18n';
import { fetchTripPhotos, tripPhotoUrl } from '../services/api';
import type { TripPhoto, TripPhotos } from '../types/api';
import type { LatLon } from '../types/geo';
import type { StoryInput } from '../types/preview';
import { bearing, distanceM } from '../utils/geo';
import { clamp01, FONT, wrapLines } from './canvas';
import type { FlyoverMap, MapCamera, MapLook } from './flyoverMap';
import { buildStory, pathThere, type Story } from './story';
import {
  drawChips,
  drawReveal,
  drawUnderline,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  linesHeight,
  revealDuration,
  type TitleStyle,
  titleLines,
} from './titles';

export const FILM_WIDTH = 1080;
export const FILM_HEIGHT = 1920;

interface LoadedPhoto {
  photo: TripPhoto;
  image: HTMLCanvasElement;
  /** A soft, darkened copy that fills the frame behind the photo. */
  backdrop: HTMLCanvasElement;
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
  chips?: string[];
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

type CardEntrance = 'pop' | 'slide' | 'rise';

interface PhotoShot {
  view: 'photo';
  photo: TripPhoto;
  image: HTMLCanvasElement;
  backdrop: HTMLCanvasElement;
  start: number;
  length: number;
  /** Wide photos sit on a card, since filling a 9:16 frame would crop them down to a sliver. */
  layout: 'full' | 'card';
  entrance: CardEntrance;
  /** Degrees the card leans. */
  tilt: number;
  from: Framing;
  to: Framing;
}

/** A thing to do without a photo of its own, shown with its number over a soft photo of the park. */
interface NoteShot {
  view: 'note';
  backdrop: HTMLCanvasElement;
  /** Notes often share one backdrop, so each drifts its own way and every other one is mirrored. */
  from: Framing;
  to: Framing;
  mirrored: boolean;
  number: number;
  start: number;
  length: number;
}

type Shot = MapShot | PhotoShot | NoteShot;

interface CaptionSpan {
  caption: Caption;
  start: number;
  end: number;
  /** Over the map along the bottom; centered under a photo card or a number; or the end card. */
  placement: 'bottom' | 'below' | 'end';
  /** Where 'below' captions start. */
  top?: number;
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
const SHOT_BEATS = { opening: 7, route: 14, arrival: 6, thing: 5, ending: 8 };
/** Photo and note shots stay up long enough to read their caption, within these beats. */
const READ_BEATS = { min: 5, max: 8 };
const PHOTO_ONLY_BEATS = 4;
const MAX_PHOTOS = 4;
const MAX_MAP_THINGS = 3;
const FADE_SEC = 0.35;

/** Photos wider than this go on a card instead of filling the frame. */
const CARD_MIN_ASPECT = 0.8;
/** Panoramas are cropped to this on the card, and the camera pans across the rest. */
const CARD_MAX_ASPECT = 1.5;
const CARD_MAX_WIDTH = FILM_WIDTH - 160;
const CARD_MAX_HEIGHT = 1000;
const CARD_CENTER_Y = FILM_HEIGHT * 0.4;
const CARD_IN_SEC = 0.55;
const CARD_OUT_SEC = 0.3;
const CARD_ENTRANCES: CardEntrance[] = ['pop', 'slide', 'rise'];
/** Camera moves inside a photo, taken in turn so no two photos in a row move alike. */
const PHOTO_MOVES: [Framing, Framing][] = [
  [
    { scale: 1, x: 0, y: 0 },
    { scale: 1.12, x: 0, y: 0 },
  ],
  [
    { scale: 1.1, x: -0.8, y: 0 },
    { scale: 1.1, x: 0.8, y: 0 },
  ],
  [
    { scale: 1.14, x: 0, y: 0.3 },
    { scale: 1.02, x: 0, y: 0 },
  ],
  [
    { scale: 1.1, x: 0.8, y: 0 },
    { scale: 1.1, x: -0.8, y: 0 },
  ],
];
const NOTE_BADGE_Y = 720;
const NOTE_BADGE_RADIUS = 96;

const BOTTOM_TITLE: TitleStyle = { kicker: 30, title: 72, sub: 36, maxWidth: FILM_WIDTH - 160, titleLines: 3 };
const BELOW_TITLE: TitleStyle = { kicker: 30, title: 64, sub: 34, maxWidth: FILM_WIDTH - 200, titleLines: 3 };
const END_TITLE: TitleStyle = { kicker: 30, title: 92, sub: 36, maxWidth: FILM_WIDTH - 160, titleLines: 2 };
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
  const zoom = Math.log2(
    Math.min(
      (VIEW_WIDTH - 2 * pad) / ((maxX - minX) * 512 || 1e-9),
      (VIEW_HEIGHT - 2 * pad) / ((maxY - minY) * 512 || 1e-9),
    ),
  );
  return { center: fromMercator((minX + maxX) / 2, (minY + maxY) / 2), zoom: Math.min(Math.max(zoom, 11), 16.5) };
}

/** Longer ways are followed from higher up, so the walker never races across the frame. */
const trackZoom = (track: Track) =>
  Math.min(17, Math.max(15.2, 16.8 - 0.8 * Math.log2(Math.max(track.length, 400) / 1200)));

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
  const wide: MapCamera = {
    center: view.center,
    zoom: view.zoom - 0.15,
    pitch: 35,
    bearing: startHeading - 25,
    lift: 0,
  };

  const follow = (fraction: number, progress: number): MapCamera => ({
    center: pointAt(track, fraction * track.length),
    zoom: zoom - 0.1 + 0.2 * progress,
    pitch: TRACK_PITCH,
    bearing: headingAt(track, fraction * track.length),
    lift: TRACK_LIFT,
  });
  const arrived = follow(1, 1);
  const circled: MapCamera = {
    center: destination,
    zoom: Math.max(zoom + 0.6, 17),
    pitch: 55,
    bearing: endHeading + 70,
    lift: 120,
  };
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
  ctx.filter = gloomy
    ? 'saturate(0.78) contrast(1.04) brightness(0.96)'
    : 'saturate(0.9) contrast(1.06) brightness(1.01)';
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/** Averages each pixel with its eight neighbors; layering at 1/n opacity keeps an equal share for each copy. */
function softenPixels(canvas: HTMLCanvasElement) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')!.drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d')!;
  let drawn = 0;
  for (const dx of [0, -1, 1]) {
    for (const dy of [0, -1, 1]) {
      drawn += 1;
      ctx.globalAlpha = 1 / drawn;
      ctx.drawImage(copy, dx, dy);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The photo shrunk to a few pixels and scaled back up, which blurs it the same in every browser
 * (canvas filters aren't everywhere), then darkened so a card or text stands out on it.
 * Scaling up alone leaves a grid of soft squares, so the smallest steps are averaged with their
 * neighbors first, and each step at most doubles the size.
 */
function backdropOf(image: HTMLCanvasElement) {
  const steps = [
    [45, 80],
    [90, 160],
    [180, 320],
    [360, 640],
    [720, 1280],
  ];
  let source: CanvasImageSource = image;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let canvas = document.createElement('canvas');
  for (const [width, height] of steps) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const cover = Math.max(width / sourceWidth, height / sourceHeight);
    ctx.drawImage(
      source,
      (width - sourceWidth * cover) / 2,
      (height - sourceHeight * cover) / 2,
      sourceWidth * cover,
      sourceHeight * cover,
    );
    if (width <= 180) {
      softenPixels(canvas);
      softenPixels(canvas);
    }
    source = canvas;
    sourceWidth = width;
    sourceHeight = height;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(8, 12, 18, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

async function loadPhoto(photo: TripPhoto, input: StoryInput, signal: AbortSignal): Promise<LoadedPhoto> {
  signal.throwIfAborted();
  const image = new Image();
  image.src = tripPhotoUrl(photo.key);
  const tooSlow = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Photo too slow')), PHOTO_WAIT_MS),
  );
  const stopped = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }),
  );
  await Promise.race([image.decode(), tooSlow, stopped]);
  const graded = grade(image, input);
  return { photo, image: graded, backdrop: backdropOf(graded) };
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
        openFlyoverMap({
          path: there,
          width: FILM_WIDTH,
          height: FILM_HEIGHT,
          look: lookFor(input),
          stops: warmUpStops(camera),
          signal,
        }),
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

/** Enough beats to read the caption once it has come in, so shots vary in length with what they say. */
function readingBeats(text: Caption, beat: number) {
  const chars = `${text.title} ${text.sub ?? ''}`.trim().length;
  const seconds = CARD_IN_SEC + chars / messages().film.readCharsPerSec;
  return Math.min(READ_BEATS.max, Math.max(READ_BEATS.min, Math.ceil(seconds / beat)));
}

function cardRect(image: HTMLCanvasElement) {
  const aspect = Math.min(image.width / image.height, CARD_MAX_ASPECT);
  let width = CARD_MAX_WIDTH;
  let height = width / aspect;
  if (height > CARD_MAX_HEIGHT) {
    height = CARD_MAX_HEIGHT;
    width = height * aspect;
  }
  return { x: (FILM_WIDTH - width) / 2, y: CARD_CENTER_Y - height / 2, width, height };
}

function walkCaption(input: StoryInput): Caption {
  const t = messages().film;
  const byBike = input.bikeStation !== null;
  const { route } = input;
  const there = route ? Math.round(route.durationMin / 2) : Math.round(input.durationMin / 2);
  const km = route ? (route.distanceM / 2000).toFixed(1) : null;
  return {
    kicker: byBike ? t.byBike(input.bikeStation?.name ?? '') : t.onFoot,
    title: t.onTheWay(input.placeName),
    sub: t.wayThere(km, there),
  };
}

function creditsFor(photos: TripPhoto[]) {
  const t = messages().film;
  const lines = [t.mapCredit(MAP_CREDIT)];
  const street = [...new Set(photos.filter((photo) => photo.source === 'mapillary').map((photo) => photo.creator))];
  if (street.length > 0) {
    const names = street.length > 3 ? t.andOthers(street.slice(0, 3)) : street.join(', ');
    lines.push(t.mapillaryCredit(names));
  }
  const commons = photos.filter((photo) => photo.source === 'wikimedia');
  for (const photo of new Map(commons.map((p) => [p.creator + p.license, p])).values()) {
    lines.push(t.commonsCredit(photo.creator, photo.license));
  }
  return lines;
}

function buildFilm(input: StoryInput, bpm: number, map: FlyoverMap, camera: Plan, photos: LoadedPhoto[]): Film {
  const story = buildStory(input, bpm);
  const { film: t, weather } = messages();
  const beat = 60 / bpm;
  const shots: Shot[] = [];
  const captions: CaptionSpan[] = [];
  let start = 0;

  const addMap = (
    kind: MapShotKind,
    beats: number,
    move: (p: number) => MapCamera,
    walker: (p: number) => number | null,
  ) => {
    const shot: MapShot = { view: 'map', kind, start, length: beats * beat, camera: move, walker };
    shots.push(shot);
    start += shot.length;
    return shot;
  };
  const caption = (
    shot: { start: number; length: number },
    text: Caption,
    placement: CaptionSpan['placement'] = 'bottom',
  ) => captions.push({ caption: text, start: shot.start, end: shot.start + shot.length, placement });

  // Establishing shot over the whole way, then down to street level where the walk starts.
  const startCamera = camera.follow(0, 0);
  const drift: MapCamera = {
    ...camera.wide,
    zoom: camera.wide.zoom + 0.25,
    pitch: 40,
    bearing: camera.wide.bearing + 10,
  };
  const opening = addMap(
    'opening',
    SHOT_BEATS.opening,
    (p) =>
      p < 0.4
        ? fly(camera.wide, drift, easeInOutSine(p / 0.4))
        : fly(drift, startCamera, easeInOutSine((p - 0.4) / 0.6)),
    (p) => (p < 0.4 ? null : 0),
  );
  const dress = input.outfitItems.slice(0, 3).map((item) => item.label.toLowerCase());
  caption(opening, {
    kicker: t.rightNow(Math.round(input.conditions.temperatureC), weather.describe(input.conditions.description)),
    title: t.nextMinutes(input.durationMin),
    sub: dress.length > 0 ? t.dressFor(Math.round(input.conditions.feelsLikeC), dress) : undefined,
  });

  // Tracking shot behind the walker, all the way to the park.
  const route = addMap('route', SHOT_BEATS.route, (p) => camera.follow(walkerAt(p), p), walkerAt);
  caption(route, walkCaption(input));

  const arrival = addMap('arrival', SHOT_BEATS.arrival, camera.orbit, () => null);
  caption(arrival, { kicker: t.arrived, title: input.placeName });

  if (photos.length > 0) {
    const things = input.things.slice(0, Math.max(photos.length, MAX_MAP_THINGS));
    // Photos beyond the things to do name the park once, then play shorter without words rather than repeat it.
    const thingCaption = (i: number): Caption => ({
      kicker: t.onceThereCount(i + 1, things.length),
      title: things[i].text,
    });
    const photoCaption = (i: number): Caption | null => {
      if (i < things.length) return thingCaption(i);
      return i === things.length ? { kicker: t.onceThere, title: input.placeName } : null;
    };
    // Three shots of the same length in a row start to feel like a slideshow.
    const used: number[] = [];
    const shotLength = (text: Caption | null) => {
      const beats = text ? readingBeats(text, beat) : PHOTO_ONLY_BEATS;
      const varied = used.length >= 2 && used.slice(-2).every((last) => last === beats) ? beats + 1 : beats;
      used.push(varied);
      return varied * beat;
    };

    photos.forEach(({ photo, image, backdrop }, i) => {
      const text = photoCaption(i);
      const [from, to] = PHOTO_MOVES[i % PHOTO_MOVES.length];
      const shot: PhotoShot = {
        view: 'photo',
        photo,
        image,
        backdrop,
        start,
        length: shotLength(text),
        layout: image.width / image.height > CARD_MIN_ASPECT ? 'card' : 'full',
        entrance: CARD_ENTRANCES[i % CARD_ENTRANCES.length],
        tilt: i % 2 ? -1.2 : 1.2,
        from,
        to,
      };
      shots.push(shot);
      start += shot.length;
      if (!text) return;
      if (shot.layout === 'card') {
        const rect = cardRect(image);
        captions.push({
          caption: text,
          start: shot.start,
          end: start,
          placement: 'below',
          top: rect.y + rect.height + 64,
        });
      } else {
        caption(shot, text);
      }
    });

    // Things to do beyond the photos still get their moment, each with its number.
    for (let i = photos.length; i < things.length; i++) {
      const text = thingCaption(i);
      const [from, to] = PHOTO_MOVES[i % PHOTO_MOVES.length];
      const shot: NoteShot = {
        view: 'note',
        backdrop: photos[i % photos.length].backdrop,
        from: { ...from, scale: from.scale + 0.08 },
        to: { ...to, scale: to.scale + 0.08 },
        mirrored: i % 2 === 1,
        number: i + 1,
        start,
        length: shotLength(text),
      };
      shots.push(shot);
      start += shot.length;
      captions.push({
        caption: text,
        start: shot.start,
        end: start,
        placement: 'below',
        top: NOTE_BADGE_Y + NOTE_BADGE_RADIUS + 80,
      });
    }
  } else {
    // No photos: keep circling the park while the things to do come up one by one.
    const things = input.things.slice(0, MAX_MAP_THINGS);
    if (things.length > 0) {
      const each = SHOT_BEATS.thing * beat;
      const circling = addMap(
        'things',
        SHOT_BEATS.thing * things.length,
        (p) => camera.orbit(1 + p * things.length),
        () => null,
      );
      things.forEach((thing, i) =>
        caption(
          { start: circling.start + i * each, length: each },
          { kicker: t.onceThereCount(i + 1, things.length), title: thing.text },
        ),
      );
    }
  }

  // Pull back up over the whole way, so the park reads as part of the neighborhood.
  const previous = shots[shots.length - 1];
  const from = previous.view === 'map' ? previous.camera(1) : camera.orbit(1);
  const ending = addMap(
    'ending',
    SHOT_BEATS.ending,
    (p) => camera.ending(from, p),
    () => null,
  );
  caption(
    ending,
    {
      kicker: input.discovery ?? undefined,
      title: t.ready,
      chips: [t.leaveNow, t.backBy(story.backBy), ...(story.sunsetAt ? [t.sunset(story.sunsetAt)] : [])],
    },
    'end',
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fills `rect` with the image like CSS `cover`, zoomed and panned within the spare edges by `view`. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  rect: Rect,
  view: Framing,
) {
  const cover = Math.max(rect.width / image.width, rect.height / image.height) * view.scale;
  const width = image.width * cover;
  const height = image.height * cover;
  const spareX = (width - rect.width) / 2;
  const spareY = (height - rect.height) / 2;
  ctx.drawImage(
    image,
    rect.x + (rect.width - width) / 2 + spareX * view.x * 0.9,
    rect.y + (rect.height - height) / 2 + spareY * view.y * 0.9,
    width,
    height,
  );
}

const FRAME: Rect = { x: 0, y: 0, width: FILM_WIDTH, height: FILM_HEIGHT };

/** The soft copy of a photo, drifting slowly closer behind whatever sits on it. */
function drawBackdrop(ctx: CanvasRenderingContext2D, backdrop: HTMLCanvasElement, progress: number) {
  drawCover(ctx, backdrop, FRAME, { scale: lerp(1.04, 1.12, progress), x: 0, y: 0 });
}

function framingAt(shot: { from: Framing; to: Framing }, progress: number): Framing {
  const p = easeInOutSine(progress);
  return {
    scale: lerp(shot.from.scale, shot.to.scale, p),
    x: lerp(shot.from.x, shot.to.x, p),
    y: lerp(shot.from.y, shot.to.y, p),
  };
}

/** How a card comes in during the first moments of its shot; it settles exactly at its resting place. */
function cardEntrance(entrance: CardEntrance, shown: number, tilt: number) {
  const eased = easeOutCubic(shown);
  if (entrance === 'pop') return { x: 0, y: 0, scale: lerp(0.84, 1, easeOutBack(shown)), rotate: tilt };
  if (entrance === 'slide')
    return { x: Math.sign(tilt) * 180 * (1 - eased), y: 0, scale: 1, rotate: tilt * (1 + 3 * (1 - eased)) };
  return { x: 0, y: 160 * (1 - eased), scale: lerp(0.94, 1, eased), rotate: tilt };
}

function drawPhotoShot(ctx: CanvasRenderingContext2D, shot: PhotoShot, progress: number, t: number, still: boolean) {
  const p = clamp01(still ? 0.5 : progress);
  const sway = still ? { x: 0, y: 0, rotate: 0 } : handheld(t);
  if (shot.layout === 'full') {
    ctx.save();
    ctx.translate(FILM_WIDTH / 2 + sway.x, FILM_HEIGHT / 2 + sway.y);
    ctx.rotate(sway.rotate);
    ctx.translate(-FILM_WIDTH / 2, -FILM_HEIGHT / 2);
    drawCover(ctx, shot.image, FRAME, framingAt(shot, p));
    ctx.restore();
    return;
  }

  drawBackdrop(ctx, shot.backdrop, p);
  // The card waits for the crossfade into this shot, then comes in on the beat.
  const shown = still ? 1 : clamp01((t - shot.start) / CARD_IN_SEC);
  const leaving = still ? 1 : clamp01((shot.start + shot.length - t) / CARD_OUT_SEC);
  if (shown <= 0) return;
  const move = cardEntrance(shot.entrance, shown, shot.tilt);
  const rect = cardRect(shot.image);
  const scale = move.scale * lerp(0.96, 1, leaving);

  ctx.save();
  ctx.globalAlpha *= easeOutCubic(shown) * (1 - easeInCubic(1 - leaving));
  ctx.translate(FILM_WIDTH / 2 + move.x + sway.x * 0.6, CARD_CENTER_Y + move.y + sway.y * 0.6);
  ctx.rotate((move.rotate * Math.PI) / 180 + sway.rotate);
  ctx.scale(scale, scale);
  const card: Rect = { x: -rect.width / 2, y: -rect.height / 2, width: rect.width, height: rect.height };
  const border = 10;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.roundRect(card.x - border, card.y - border, card.width + border * 2, card.height + border * 2, 34);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.width, card.height, 26);
  ctx.clip();
  drawCover(ctx, shot.image, card, framingAt(shot, p));
  ctx.restore();
}

function drawNoteShot(ctx: CanvasRenderingContext2D, shot: NoteShot, progress: number, t: number, still: boolean) {
  ctx.save();
  if (shot.mirrored) {
    ctx.translate(FILM_WIDTH, 0);
    ctx.scale(-1, 1);
  }
  drawCover(ctx, shot.backdrop, FRAME, framingAt(shot, clamp01(still ? 0.5 : progress)));
  ctx.restore();
  const shown = still ? 1 : clamp01((t - shot.start) / CARD_IN_SEC);
  if (shown <= 0) return;
  const at = { x: FILM_WIDTH / 2, y: NOTE_BADGE_Y };

  ctx.save();
  // One ring spreads out as the number lands.
  const ring = still ? 1 : clamp01((t - shot.start) / 1.1);
  if (ring < 1) {
    ctx.strokeStyle = `rgba(52, 199, 89, ${0.6 * (1 - ring)})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(at.x, at.y, NOTE_BADGE_RADIUS * (1 + 0.9 * easeOutCubic(ring)), 0, Math.PI * 2);
    ctx.stroke();
  }
  const scale = lerp(0.6, 1, easeOutBack(shown));
  ctx.globalAlpha *= easeOutCubic(shown);
  ctx.translate(at.x, at.y);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(0, 0, NOTE_BADGE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'white';
  ctx.font = `800 108px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(shot.number), 0, 6);
  ctx.restore();
}

const onScreen = ({ x, y }: { x: number; y: number }, margin: number) =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  x > -margin &&
  x < FILM_WIDTH + margin &&
  y > -margin &&
  y < FILM_HEIGHT + margin;

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
function drawWalker(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  toward: { x: number; y: number },
  t: number,
) {
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

function drawMapShot(
  ctx: CanvasRenderingContext2D,
  film: Film,
  shot: MapShot,
  progress: number,
  t: number,
  still: boolean,
) {
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

const TITLE_STYLE: Record<CaptionSpan['placement'], TitleStyle> = {
  bottom: BOTTOM_TITLE,
  below: BELOW_TITLE,
  end: END_TITLE,
};

/** Shading that keeps white text readable over a bright map or photo, strongest where the text is. */
function drawScrim(ctx: CanvasRenderingContext2D, placement: CaptionSpan['placement'], height: number, alpha: number) {
  if (placement === 'bottom') {
    const top = FILM_HEIGHT - 500 - height;
    const scrim = ctx.createLinearGradient(0, top, 0, FILM_HEIGHT);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    scrim.addColorStop(1, `rgba(0, 0, 0, ${0.62 * alpha})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, top, FILM_WIDTH, FILM_HEIGHT - top);
  } else if (placement === 'end') {
    // Darkens the sky above the title but leaves the neighborhood below it in view.
    const scrim = ctx.createLinearGradient(0, 0, 0, FILM_HEIGHT * 0.62);
    scrim.addColorStop(0, `rgba(0, 0, 0, ${0.6 * alpha})`);
    scrim.addColorStop(0.55, `rgba(0, 0, 0, ${0.38 * alpha})`);
    scrim.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT * 0.62);
  }
}

function drawCaption(ctx: CanvasRenderingContext2D, span: CaptionSpan, t: number, still: boolean) {
  // The opening title is readable on the first frame, before anyone scrolls past.
  const delay = span.start === 0 ? -0.6 : 0.1;
  const elapsed = still ? 99 : t - span.start - delay;
  const fadeIn = still ? 1 : clamp01(elapsed / 0.3);
  const fadeOut = still ? 1 : 1 - easeInCubic(1 - clamp01((span.end - t) / 0.35));
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;

  const lines = titleLines(ctx, span.caption, TITLE_STYLE[span.placement]);
  const height = linesHeight(lines);
  drawScrim(ctx, span.placement, height, alpha);

  if (span.placement === 'bottom') {
    drawReveal(ctx, lines, { x: 80, y: FILM_HEIGHT - 260 - height, align: 'left' }, elapsed, fadeOut);
    return;
  }
  if (span.placement === 'below') {
    drawReveal(ctx, lines, { x: FILM_WIDTH / 2, y: span.top ?? FILM_HEIGHT * 0.6, align: 'center' }, elapsed, fadeOut);
    return;
  }

  // The end card: the title, a line drawn under it, then when to go and be back.
  const top = FILM_HEIGHT * 0.33 - height / 2;
  drawReveal(ctx, lines, { x: FILM_WIDTH / 2, y: top, align: 'center' }, elapsed, fadeOut);
  const settled = elapsed - revealDuration(lines);
  const lineY = top + height + 30;
  drawUnderline(ctx, { x: FILM_WIDTH / 2, y: lineY }, 420, settled + 0.15, fadeOut, GREEN);
  if (span.caption.chips)
    drawChips(ctx, span.caption.chips, { x: FILM_WIDTH / 2, y: lineY + 90 }, settled + 0.35, fadeOut);
}

function sourceLabel(shot: Shot) {
  if (shot.view === 'map') return MAP_CREDIT;
  if (shot.view === 'note') return null;
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
  else if (shot.view === 'photo') drawPhotoShot(ctx, shot, progress, t, still);
  else drawNoteShot(ctx, shot, progress, t, still);
}

export function drawFilmFrame(ctx: CanvasRenderingContext2D, film: Film, t: number, still: boolean) {
  const found = film.shots.findIndex((candidate) => t < candidate.start + candidate.length);
  const index = found === -1 ? film.shots.length - 1 : found;
  const shot = film.shots[index];
  const next = film.shots[index + 1];
  const end = shot.start + shot.length;
  // Map shots flow into each other as one camera move; cuts to and from photos and notes crossfade.
  const fade = next && (shot.view !== 'map' || next.view !== 'map') ? Math.min(FADE_SEC, shot.length * 0.3) : 0;
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

  const source = sourceLabel(fading ? next : shot);
  if (source) drawSourceTag(ctx, source);
  for (const span of film.captions) {
    if (t >= span.start && t <= span.end) drawCaption(ctx, span, t, still);
  }
  if (shot.view === 'map' && shot.kind === 'ending')
    drawCredits(ctx, film, still ? 1 : clamp01((t - shot.start - 0.6) / 0.6));
  drawProgress(ctx, Math.min(t / film.total, 1));
  ctx.restore();
}
