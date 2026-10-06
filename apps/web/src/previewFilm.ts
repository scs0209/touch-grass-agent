import { buildStory, pathThere, type Story, type StoryInput } from './previewDraw';

export const FILM_WIDTH = 1080;
export const FILM_HEIGHT = 1920;

/** Must match TripPhoto in apps/server/src/conditions/photos.ts. */
export interface TripPhoto {
  key: string;
  kind: 'street' | 'arrival' | 'place';
  source: 'mapillary' | 'wikimedia';
  creator: string;
  license: string;
  capturedAt: string | null;
}

interface TripPhotos {
  street: TripPhoto[];
  arrival: TripPhoto | null;
  place: TripPhoto[];
}

type ShotKind = 'opening' | 'street' | 'arrival' | 'place' | 'ending';

/** Where the camera looks: zoom past the cover crop, and pan within the spare edges (-1 to 1). */
interface Camera {
  scale: number;
  x: number;
  y: number;
}

interface Caption {
  kicker?: string;
  title: string;
  sub?: string;
}

interface Shot {
  kind: ShotKind;
  photo: TripPhoto;
  image: HTMLCanvasElement;
  start: number;
  length: number;
  from: Camera;
  to: Camera;
}

interface CaptionSpan {
  caption: Caption;
  start: number;
  end: number;
  /** Ending captions sit higher, clear of the end-screen buttons. */
  placement: 'bottom' | 'center';
}

export interface Film {
  story: Story;
  shots: Shot[];
  captions: CaptionSpan[];
  credits: string[];
  total: number;
}

/** Shot lengths in beats, so every cut lands on the music. */
const SHOT_BEATS: Record<ShotKind, number> = { opening: 5, street: 2, arrival: 6, place: 5, ending: 8 };
const STREET_SHOTS_MAX = 7;
const MIN_STREET_SHOTS = 4;
const FADE_SEC = 0.35;

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

// ---------- loading ----------

async function fetchTripPhotos(input: StoryInput): Promise<TripPhotos | null> {
  const there = pathThere(input);
  // pathThere ends at the park itself; the server wants the way up to the park's edge.
  const path = input.route ? there.slice(0, -1) : there;
  const response = await fetch('/api/trip-photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, destination: input.destination, placeName: input.placeName }),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { photos: TripPhotos | null }).photos;
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

async function loadPhoto(photo: TripPhoto, input: StoryInput) {
  const image = new Image();
  image.src = `/api/trip-photos/${photo.key}`;
  await image.decode();
  return grade(image, input);
}

/** Loads real photos of the way and the park; null when there are too few to make a film. */
export async function loadFilm(input: StoryInput, bpm: number): Promise<Film | null> {
  const photos = await fetchTripPhotos(input);
  if (!photos) return null;

  const all = [...photos.street, ...(photos.arrival ? [photos.arrival] : []), ...photos.place];
  const loaded = await Promise.all(all.map((photo) => loadPhoto(photo, input).catch(() => null)));
  const images = new Map(all.flatMap((photo, i) => (loaded[i] ? [[photo.key, loaded[i]] as const] : [])));

  const street = photos.street.filter((photo) => images.has(photo.key));
  const arrival = photos.arrival && images.has(photos.arrival.key) ? photos.arrival : null;
  const place = photos.place.filter((photo) => images.has(photo.key));
  if (street.length < MIN_STREET_SHOTS || (!arrival && place.length === 0)) return null;

  return buildFilm(input, bpm, { street, arrival, place }, images);
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

function creditsFor(shots: Shot[]) {
  const unique = (photos: TripPhoto[]) => [...new Set(photos.map((photo) => photo.creator))];
  const street = unique(shots.map((shot) => shot.photo).filter((photo) => photo.source === 'mapillary'));
  const commons = shots.map((shot) => shot.photo).filter((photo) => photo.source === 'wikimedia');
  const lines: string[] = [];
  if (street.length > 0) {
    const names = street.length > 3 ? `${street.slice(0, 3).join(', ')} and others` : street.join(', ');
    lines.push(`Street photos: ${names} on Mapillary, CC BY-SA 4.0`);
  }
  for (const photo of new Map(commons.map((p) => [p.creator + p.license, p])).values()) {
    lines.push(`Photo: ${photo.creator}, ${photo.license}, via Wikimedia Commons`);
  }
  return lines;
}

function buildFilm(
  input: StoryInput,
  bpm: number,
  photos: { street: TripPhoto[]; arrival: TripPhoto | null; place: TripPhoto[] },
  images: Map<string, HTMLCanvasElement>,
): Film {
  const story = buildStory(input, bpm);
  const beat = 60 / bpm;
  const shots: Shot[] = [];
  const captions: CaptionSpan[] = [];
  let start = 0;

  const add = (kind: ShotKind, photo: TripPhoto, from: Camera, to: Camera) => {
    const length = SHOT_BEATS[kind] * beat;
    shots.push({ kind, photo, image: images.get(photo.key)!, start, length, from, to });
    start += length;
    return shots[shots.length - 1];
  };

  const [first, ...rest] = photos.street;
  const dress = input.outfitItems.slice(0, 3).map((item) => item.label.toLowerCase());
  const opening = add('opening', first, { scale: 1.04, x: 0, y: 0.1 }, { scale: 1.14, x: 0, y: -0.05 });
  captions.push({
    caption: {
      kicker: `${Math.round(input.conditions.temperatureC)}° · ${input.conditions.description} right now`,
      title: `Your next ${input.durationMin} minutes`,
      sub: dress.length > 0 ? `Dress for ${Math.round(input.conditions.feelsLikeC)}°: ${dress.join(', ')}` : undefined,
    },
    start: opening.start,
    end: opening.start + opening.length,
    placement: 'bottom',
  });

  // Push in on every street photo, like walking forward down the street.
  const walking = rest.slice(0, STREET_SHOTS_MAX).map((photo, i) =>
    add('street', photo, { scale: 1.06, x: i % 2 ? 0.08 : -0.08, y: 0 }, { scale: 1.18, x: 0, y: -0.04 }),
  );
  if (walking.length > 0) {
    captions.push({ caption: walkCaption(input), start: walking[0].start, end: start, placement: 'bottom' });
  }

  if (photos.arrival) {
    const shot = add('arrival', photos.arrival, { scale: 1.03, x: 0, y: 0.05 }, { scale: 1.12, x: 0, y: -0.02 });
    captions.push({
      caption: { kicker: "You've arrived", title: input.placeName },
      start: shot.start,
      end: shot.start + shot.length,
      placement: 'bottom',
    });
  }

  photos.place.forEach((photo, i) => {
    const pan = i % 2 ? -0.7 : 0.7;
    const shot = add('place', photo, { scale: 1.1, x: -pan, y: 0 }, { scale: 1.12, x: pan, y: 0 });
    const thing = input.things[i];
    captions.push({
      caption: thing
        ? { kicker: `Once you're there · ${i + 1}/${Math.min(input.things.length, photos.place.length)}`, title: thing.text }
        : { kicker: 'Once you\'re there', title: input.placeName },
      start: shot.start,
      end: shot.start + shot.length,
      placement: 'bottom',
    });
  });

  // Pull back out to the street the park sits on, so it reads as part of the neighborhood.
  const ending = add('ending', photos.street[photos.street.length - 1], { scale: 1.18, x: 0, y: -0.04 }, { scale: 1.02, x: 0, y: 0.04 });
  captions.push({
    caption: {
      title: 'Ready when you are.',
      sub: `Leave now · back by ${story.backBy}${story.sunsetAt ? ` · sunset ${story.sunsetAt}` : ''}`,
    },
    start: ending.start,
    end: ending.start + ending.length,
    placement: 'center',
  });

  return { story, shots, captions, credits: creditsFor(shots), total: start };
}

// ---------- drawing ----------

const camera = (shot: Shot, progress: number): Camera => {
  const p = easeInOutSine(clamp01(progress));
  return {
    scale: shot.from.scale + (shot.to.scale - shot.from.scale) * p,
    x: shot.from.x + (shot.to.x - shot.from.x) * p,
    y: shot.from.y + (shot.to.y - shot.from.y) * p,
  };
};

/** A slight drift, like a camera held by someone walking; stays inside the extra zoom. */
function handheld(t: number) {
  return {
    x: 5 * Math.sin(t * 0.9) + 2.5 * Math.sin(t * 2.3 + 1),
    y: 4 * Math.sin(t * 1.1 + 2) + 2 * Math.sin(t * 2.9),
    rotate: 0.0025 * Math.sin(t * 0.7),
  };
}

function drawShot(ctx: CanvasRenderingContext2D, shot: Shot, progress: number, t: number, still: boolean) {
  const { image } = shot;
  const view = camera(shot, still ? 0.5 : progress);
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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
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

function drawSourceTag(ctx: CanvasRenderingContext2D, photo: TripPhoto) {
  const year = photo.capturedAt?.match(/\d{4}/)?.[0];
  const label = `${photo.source === 'mapillary' ? 'Mapillary' : 'Wikimedia Commons'}${year ? ` · ${year}` : ''}`;
  ctx.save();
  ctx.font = `500 24px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText(label, FILM_WIDTH - 48, FILM_HEIGHT - 40);
  ctx.restore();
}

function drawCredits(ctx: CanvasRenderingContext2D, film: Film, alpha: number) {
  ctx.save();
  ctx.font = `500 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * alpha})`;
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

export function drawFilmFrame(ctx: CanvasRenderingContext2D, film: Film, t: number, still: boolean) {
  const found = film.shots.findIndex((candidate) => t < candidate.start + candidate.length);
  const index = found === -1 ? film.shots.length - 1 : found;
  const shot = film.shots[index];
  const next = film.shots[index + 1];
  const end = shot.start + shot.length;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  drawShot(ctx, shot, (t - shot.start) / shot.length, t, still);
  const fade = Math.min(FADE_SEC, shot.length * 0.3);
  if (next && !still && t > end - fade) {
    ctx.globalAlpha = (t - (end - fade)) / fade;
    drawShot(ctx, next, 0, t, still);
    ctx.globalAlpha = 1;
  }
  drawLight(ctx, film.story);

  const showing = t > end - fade && next ? next : shot;
  drawSourceTag(ctx, showing.photo);
  for (const span of film.captions) {
    if (t >= span.start && t <= span.end) drawCaption(ctx, span, t, still);
  }
  if (shot.kind === 'ending') drawCredits(ctx, film, still ? 1 : clamp01((t - shot.start - 0.6) / 0.6));
  drawProgress(ctx, Math.min(t / film.total, 1));
  ctx.restore();
}
