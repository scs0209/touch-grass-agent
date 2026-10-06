import type { OutfitItem } from './OutfitCards';
import { skyIcon, type Sky, type WeatherConditions } from './WeatherPanel';

export const WIDTH = 720;
export const HEIGHT = 1280;

export type ThingScene =
  | 'playground'
  | 'sports field'
  | 'running track'
  | 'outdoor gym'
  | 'benches'
  | 'drinking fountain'
  | 'viewpoint'
  | 'water'
  | 'sunset'
  | 'stretch'
  | 'season'
  | 'photo'
  | 'rest'
  | 'walk';

type LatLon = { lat: number; lon: number };

/** Must match Route in apps/server/src/conditions/route.ts. */
export interface Route {
  mode: 'foot' | 'bike';
  coordinates: [number, number][];
  destinationOnPath: [number, number];
  distanceM: number;
  /** The whole trip, including renting and returning the bike on a bike trip. */
  durationMin: number;
  rideMin: number;
  walkMin: number;
}

export interface StoryInput {
  durationMin: number;
  placeName: string;
  features: string[];
  origin: LatLon;
  destination: LatLon;
  route: Route | null;
  /** Set when the suggestion is a bike ride from this station. */
  bikeStation: (LatLon & { name: string }) | null;
  things: { text: string; scene: ThingScene }[];
  outfitItems: OutfitItem[];
  conditions: WeatherConditions;
}

export interface Assets {
  avatar: HTMLImageElement;
  images: Map<string, HTMLImageElement>;
}

type SceneKind = 'intro' | 'outfit' | 'walk' | 'arrive' | 'thing' | 'ending';

interface Scene {
  kind: SceneKind;
  index: number;
  start: number;
  length: number;
}

export interface Story {
  input: StoryInput;
  beat: number;
  scenes: Scene[];
  total: number;
  backBy: string;
  sunsetAt: string | null;
  season: Season;
}

/** Scene lengths in beats, so every cut lands on the music. */
const SCENE_BEATS: Record<SceneKind, number> = { intro: 4, outfit: 8, walk: 8, arrive: 4, thing: 6, ending: 8 };

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** `sunset` is a local wall-clock time at the destination, so times derived from it stay in the park's time zone. */
function clockMinutes(isoLocal: string) {
  return Number(isoLocal.slice(11, 13)) * 60 + Number(isoLocal.slice(14, 16));
}

function formatClock(minutes: number) {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function seasonAt(isoLocal: string, lat: number): Season {
  const month = Number(isoLocal.slice(5, 7));
  const shifted = lat < 0 ? ((month + 5) % 12) + 1 : month;
  if (shifted >= 3 && shifted <= 5) return 'spring';
  if (shifted >= 6 && shifted <= 8) return 'summer';
  if (shifted >= 9 && shifted <= 11) return 'autumn';
  return 'winter';
}

export function buildStory(input: StoryInput, bpm: number): Story {
  const beat = 60 / bpm;
  const kinds: { kind: SceneKind; index: number }[] = [
    { kind: 'intro', index: 0 },
    { kind: 'outfit', index: 0 },
    { kind: 'walk', index: 0 },
    { kind: 'arrive', index: 0 },
    ...input.things.map((_, index) => ({ kind: 'thing' as const, index })),
    { kind: 'ending', index: 0 },
  ];
  let start = 0;
  const scenes = kinds.map((scene) => {
    const length = SCENE_BEATS[scene.kind] * beat;
    const placed = { ...scene, start, length };
    start += length;
    return placed;
  });

  const { sunset, minutesUntilSunset } = input.conditions;
  const now = clockMinutes(sunset) - minutesUntilSunset;
  const sunsetSoon = minutesUntilSunset > 0 && minutesUntilSunset <= input.durationMin + 30;
  return {
    input,
    beat,
    scenes,
    total: start,
    backBy: formatClock(now + input.durationMin),
    sunsetAt: sunsetSoon ? sunset.slice(11, 16) : null,
    season: seasonAt(sunset, input.origin.lat),
  };
}

/** Every image the story draws, so they can be loaded before playback starts. */
export function imagePaths(input: StoryInput) {
  const { sky, isDay } = input.conditions;
  return [
    ...new Set([
      `/fluent-emoji/${skyIcon(sky, isDay)}_3d.png`,
      '/fluent-emoji/cloud_3d.png',
      '/fluent-emoji/sun_3d.png',
      '/fluent-emoji/sunset_3d.png',
      ...input.outfitItems.map((item) => item.icon),
    ]),
  ];
}

interface Frame {
  ctx: CanvasRenderingContext2D;
  story: Story;
  assets: Assets;
  scene: Scene;
  /** Seconds since the scene started. */
  local: number;
  /** Seconds since the story started; frozen at 0 when motion is reduced. */
  time: number;
  /** 1 on each beat, fading to 0 before the next. */
  pulse: number;
  still: boolean;
}

export function drawFrame(ctx: CanvasRenderingContext2D, story: Story, t: number, assets: Assets, still: boolean) {
  const scene = story.scenes.find((candidate) => t < candidate.start + candidate.length) ?? story.scenes[story.scenes.length - 1];
  const local = Math.min(Math.max(t - scene.start, 0), scene.length);
  const frame: Frame = {
    ctx,
    story,
    assets,
    scene,
    local: still ? scene.length - 0.001 : local,
    time: still ? 0 : t,
    pulse: still ? 0 : Math.exp(-6 * ((t % story.beat) / story.beat)),
    still,
  };

  ctx.save();
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  SCENE_DRAW[scene.kind](frame);
  if (!still && local < 0.18) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - local / 0.18)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  drawProgress(ctx, Math.min(t / story.total, 1));
  ctx.restore();
}

const SCENE_DRAW: Record<SceneKind, (frame: Frame) => void> = {
  intro: drawIntro,
  outfit: drawOutfit,
  walk: drawWalk,
  arrive: drawArrive,
  thing: drawThing,
  ending: drawEnding,
};

// ---------- helpers ----------

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const rand = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const pop = (frame: Frame, delay = 0, length = 0.45) => easeOutBack(clamp01((frame.local - delay) / length));

function mix(a: string, b: string, amount: number) {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [from, to] = [channels(a), channels(b)];
  return `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * amount)).join(',')})`;
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

interface TextOptions {
  size: number;
  weight?: number;
  color?: string;
  scale?: number;
  maxWidth?: number;
  maxLines?: number;
}

/** Draws centered, wrapped text with its top at `y` and returns the y below the last line. */
function drawText(ctx: CanvasRenderingContext2D, text: string, y: number, options: TextOptions) {
  const { size, weight = 800, color = '#fff', scale = 1, maxWidth = WIDTH - 120, maxLines = 3 } = options;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, text, maxWidth).slice(0, maxLines);
  const lineHeight = size * 1.18;
  const height = lines.length * lineHeight;
  ctx.translate(WIDTH / 2, y + height / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = Math.max(3, size * 0.09);
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 3;
  lines.forEach((line, i) => {
    ctx.strokeText(line, 0, -height / 2 + i * lineHeight);
    ctx.fillText(line, 0, -height / 2 + i * lineHeight);
  });
  ctx.restore();
  return y + height;
}

function drawImageCentered(frame: Frame, path: string, x: number, y: number, size: number, filter?: string) {
  const image = frame.assets.images.get(path);
  if (!image || size <= 0) return;
  const { ctx } = frame;
  ctx.save();
  if (filter) ctx.filter = filter;
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number) {
  if (size <= 0) return;
  ctx.save();
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y);
  ctx.restore();
}

function drawProgress(ctx: CanvasRenderingContext2D, progress: number) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.roundRect(40, 28, WIDTH - 80, 6, 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(40, 28, (WIDTH - 80) * progress, 6, 3);
  ctx.fill();
}

// ---------- sky and weather ----------

const SKY_COLORS: Record<Sky, [string, string]> = {
  clear: ['#4aa8f0', '#bfe6ff'],
  'partly-cloudy': ['#6fb2e6', '#d6edfa'],
  cloudy: ['#93a6b8', '#dfe6ec'],
  fog: ['#a9b6c1', '#e6eaee'],
  drizzle: ['#7389a0', '#c3cfda'],
  rain: ['#5b6f84', '#a7b6c4'],
  snow: ['#aebfd0', '#f0f4f8'],
  thunder: ['#3f4c5c', '#8796a6'],
};
const NIGHT_COLORS: [string, string] = ['#101a35', '#34446f'];
/** Blue to violet at the top, so blending with a day sky doesn't pass through grey. */
const SUNSET_COLORS: [string, string] = ['#6a6fb8', '#ffa860'];
const CLOUDY_SKIES: Sky[] = ['partly-cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder'];

function drawSky(frame: Frame, sunset = 0) {
  const { ctx } = frame;
  const { sky, isDay } = frame.story.input.conditions;
  const [top, bottom] = isDay ? SKY_COLORS[sky] : NIGHT_COLORS;
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, mix(top, SUNSET_COLORS[0], sunset));
  gradient.addColorStop(1, mix(bottom, SUNSET_COLORS[1], sunset));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (!isDay) {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + 0.5 * Math.abs(Math.sin(frame.time * 1.5 + i))})`;
      ctx.beginPath();
      ctx.arc(rand(i) * WIDTH, rand(i + 40) * HEIGHT * 0.5, 1.5 + rand(i + 80) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Clouds drift between the headline and the hills, so white text never sits on a white cloud. */
function drawClouds(frame: Frame) {
  if (!CLOUDY_SKIES.includes(frame.story.input.conditions.sky)) return;
  for (let i = 0; i < 3; i++) {
    const x = ((rand(i) * WIDTH + frame.time * (14 + i * 7)) % (WIDTH + 320)) - 160;
    drawImageCentered(frame, '/fluent-emoji/cloud_3d.png', x, 480 + i * 70, 150 + i * 25);
  }
}

function drawWeather(frame: Frame) {
  const { ctx, time } = frame;
  const { sky } = frame.story.input.conditions;
  if (sky === 'rain' || sky === 'drizzle' || sky === 'thunder') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < (sky === 'drizzle' ? 40 : 80); i++) {
      const y = (rand(i + 99) * HEIGHT + time * 900 * (0.8 + rand(i + 7) * 0.4)) % HEIGHT;
      const x = rand(i) * (WIDTH + 60);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 28);
    }
    ctx.stroke();
  }
  if (sky === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let i = 0; i < 70; i++) {
      const y = (rand(i) * HEIGHT + time * 80 * (0.6 + rand(i + 3) * 0.8)) % HEIGHT;
      const x = rand(i + 50) * WIDTH + Math.sin(time * 1.5 + i) * 14;
      ctx.beginPath();
      ctx.arc(x, y, 3 + rand(i + 9) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sky === 'thunder' && time % 5.3 < 0.09) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

// ---------- park ----------

const FOLIAGE: Record<Season, string[]> = {
  spring: ['#6cc46a', '#f2a7c3', '#8fd47e'],
  summer: ['#3f9b4f', '#4fae5c', '#2f8a44'],
  autumn: ['#e0913a', '#d4652f', '#f0b840'],
  winter: ['#7d9a7f', '#93ad94', '#6c8a6e'],
};
const TREES = [
  { x: 250, y: 800, s: 0.7 },
  { x: 470, y: 790, s: 0.6 },
  { x: 70, y: 870, s: 1.1 },
  { x: 650, y: 850, s: 1.2 },
  { x: 700, y: 1000, s: 1.3 },
  { x: 25, y: 1070, s: 1.4 },
];
const SLOTS = [
  { x: 400, y: 935, s: 0.7 },
  { x: 560, y: 965, s: 0.9 },
  { x: 180, y: 1010, s: 1 },
  { x: 560, y: 1150, s: 1.1 },
  { x: 170, y: 1195, s: 1.1 },
];

function drawTree(frame: Frame, x: number, y: number, s: number, i: number) {
  const { ctx } = frame;
  const colors = FOLIAGE[frame.story.season];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(frame.time * 1.2 + i) * 0.03);
  ctx.scale(s, s);
  ctx.fillStyle = '#8a5a3b';
  ctx.fillRect(-8, -60, 16, 60);
  [
    [0, -95, 50, 0],
    [-36, -68, 38, 1],
    [36, -68, 38, 2],
  ].forEach(([cx, cy, r, c]) => {
    ctx.fillStyle = colors[c];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

type FeatureDraw = (ctx: CanvasRenderingContext2D, time: number) => void;

const FEATURE_DRAW: Record<string, FeatureDraw> = {
  water(ctx, time) {
    ctx.fillStyle = '#5dbbe6';
    ctx.beginPath();
    ctx.ellipse(0, 0, 150, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const r = (time * 0.6 + k / 3) % 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - r) * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 30 + 100 * r, (30 + 100 * r) * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  playground(ctx, time) {
    ctx.strokeStyle = '#6b6b6b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-90, 0);
    ctx.lineTo(-60, -110);
    ctx.lineTo(-30, 0);
    ctx.moveTo(30, 0);
    ctx.lineTo(60, -110);
    ctx.lineTo(90, 0);
    ctx.moveTo(-60, -110);
    ctx.lineTo(60, -110);
    ctx.stroke();
    const angle = Math.sin(time * 2.2) * 0.4;
    ctx.save();
    ctx.translate(0, -110);
    ctx.rotate(angle);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-14, 80);
    ctx.moveTo(14, 0);
    ctx.lineTo(14, 80);
    ctx.stroke();
    ctx.fillStyle = '#e85d4a';
    ctx.fillRect(-20, 78, 40, 8);
    ctx.restore();
  },
  benches(ctx) {
    ctx.fillStyle = '#9a6a43';
    ctx.fillRect(-60, -30, 120, 12);
    ctx.fillRect(-60, -58, 120, 10);
    ctx.fillStyle = '#5b4030';
    ctx.fillRect(-52, -18, 8, 18);
    ctx.fillRect(44, -18, 8, 18);
  },
  'sports field'(ctx) {
    ctx.fillStyle = '#4f9c45';
    ctx.beginPath();
    ctx.moveTo(-110, 0);
    ctx.lineTo(110, 0);
    ctx.lineTo(80, -70);
    ctx.lineTo(-80, -70);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -70);
    ctx.stroke();
  },
  'running track'(ctx) {
    ctx.strokeStyle = '#d9774b';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.ellipse(0, -30, 120, 36, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  },
  'outdoor gym'(ctx) {
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(-50, -110, 8, 110);
    ctx.fillRect(42, -110, 8, 110);
    ctx.fillRect(-50, -112, 100, 7);
  },
  'drinking fountain'(ctx, time) {
    ctx.fillStyle = '#8fa0ad';
    ctx.fillRect(-8, -60, 16, 60);
    ctx.fillRect(-22, -70, 44, 12);
    ctx.strokeStyle = `rgba(93, 187, 230, ${0.6 + 0.3 * Math.sin(time * 6)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.quadraticCurveTo(12, -100, 22, -72);
    ctx.stroke();
  },
};

function drawViewpoint(ctx: CanvasRenderingContext2D, time: number) {
  ctx.save();
  ctx.translate(600, 735);
  ctx.fillStyle = '#8a5a3b';
  ctx.fillRect(-26, -70, 52, 8);
  ctx.fillRect(-22, -62, 6, 62);
  ctx.fillRect(16, -62, 6, 62);
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(-2, -120, 4, 50);
  ctx.fillStyle = '#e85d4a';
  ctx.beginPath();
  ctx.moveTo(2, -120);
  ctx.lineTo(34 + Math.sin(time * 4) * 4, -108);
  ctx.lineTo(2, -96);
  ctx.fill();
  ctx.restore();
}

function drawPark(frame: Frame, zoom = 1) {
  const { ctx, time } = frame;
  const features = frame.story.input.features;
  drawClouds(frame);
  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT * 0.75);
  ctx.scale(zoom, zoom);
  ctx.translate(-WIDTH / 2, -HEIGHT * 0.75);

  ctx.fillStyle = '#9bd37f';
  ctx.beginPath();
  ctx.moveTo(0, 820);
  ctx.bezierCurveTo(180, 700, 420, 760, WIDTH, 700);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.fill();
  if (features.includes('viewpoint')) drawViewpoint(ctx, time);

  ctx.fillStyle = '#74c060';
  ctx.beginPath();
  ctx.moveTo(0, 900);
  ctx.bezierCurveTo(240, 860, 480, 920, WIDTH, 870);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.fill();

  ctx.fillStyle = '#ead9b0';
  ctx.beginPath();
  ctx.moveTo(290, HEIGHT);
  ctx.bezierCurveTo(330, 1100, 420, 1000, 380, 890);
  ctx.lineTo(402, 890);
  ctx.bezierCurveTo(470, 1000, 430, 1120, 450, HEIGHT);
  ctx.fill();

  TREES.slice(0, 2).forEach((tree, i) => drawTree(frame, tree.x, tree.y, tree.s, i));
  features
    .filter((feature) => feature in FEATURE_DRAW)
    .slice(0, SLOTS.length)
    .forEach((feature, i) => {
      const slot = SLOTS[i];
      ctx.save();
      ctx.translate(slot.x, slot.y);
      ctx.scale(slot.s, slot.s);
      FEATURE_DRAW[feature](ctx, time);
      ctx.restore();
    });
  TREES.slice(2).forEach((tree, i) => drawTree(frame, tree.x, tree.y, tree.s, i + 2));
  ctx.restore();
}

// ---------- avatar ----------

type Motion = 'bob' | 'jump' | 'sway' | 'swing' | 'stretch' | 'rest';

const SCENE_MOTION: Record<ThingScene, Motion> = {
  playground: 'swing',
  'sports field': 'jump',
  'running track': 'jump',
  'outdoor gym': 'jump',
  stretch: 'stretch',
  rest: 'rest',
  benches: 'rest',
  walk: 'bob',
  season: 'bob',
  photo: 'bob',
  water: 'sway',
  viewpoint: 'sway',
  sunset: 'sway',
  'drinking fountain': 'sway',
};

/** The avatar SVG's viewBox is 200 × 330. */
const AVATAR_RATIO = 330 / 200;

function drawAvatar(frame: Frame, x: number, bottom: number, width: number, motion: Motion, scale = 1) {
  const { ctx, time, story } = frame;
  const height = width * AVATAR_RATIO;
  const phase = (time % story.beat) / story.beat;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.beginPath();
  ctx.ellipse(x, bottom, width * 0.32, width * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, bottom);
  ctx.scale(scale, scale);
  if (motion === 'bob') ctx.translate(0, -Math.abs(Math.sin(phase * Math.PI)) * 14);
  if (motion === 'jump') ctx.translate(0, -Math.sin(phase * Math.PI) * 40);
  if (motion === 'sway') ctx.rotate(Math.sin(time * 2) * 0.05);
  if (motion === 'stretch') ctx.scale(1, 1 + 0.05 * Math.sin((time * Math.PI) / story.beat));
  if (motion === 'rest') {
    ctx.translate(0, 24);
    ctx.scale(1, 0.92);
  }
  if (motion === 'swing') {
    ctx.translate(0, -height);
    ctx.rotate(Math.sin(time * 2.2) * 0.2);
    ctx.translate(0, height);
  }
  ctx.drawImage(frame.assets.avatar, -width / 2, -height, width, height);
  ctx.restore();
}

// ---------- scenes ----------

function drawIntro(frame: Frame) {
  const { ctx, story } = frame;
  const { conditions, durationMin } = story.input;
  drawSky(frame);
  drawWeather(frame);
  const size = 300 * pop(frame) * (1 + 0.04 * frame.pulse);
  drawImageCentered(frame, `/fluent-emoji/${skyIcon(conditions.sky, conditions.isDay)}_3d.png`, WIDTH / 2, 470 + Math.sin(frame.time * 2) * 10, size);
  const below = drawText(ctx, `Your next ${durationMin} minutes`, 720, { size: 66, scale: pop(frame, 0.2) });
  drawText(ctx, `${Math.round(conditions.temperatureC)}° · ${conditions.description}`, below + 30, {
    size: 38,
    weight: 600,
    scale: pop(frame, 0.45),
  });
}

const ITEM_SPOTS = [
  [130, 430],
  [590, 430],
  [130, 650],
  [590, 650],
  [130, 870],
  [590, 870],
  [360, 1130],
];

function drawOutfit(frame: Frame) {
  const { ctx, story } = frame;
  const { outfitItems, conditions } = story.input;
  drawSky(frame);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawText(ctx, `Dress for ${Math.round(conditions.feelsLikeC)}°`, 110, { size: 62, scale: pop(frame) });
  drawAvatar(frame, WIDTH / 2, 1040, 300, 'sway', pop(frame, 0.1));

  const items = outfitItems.slice(0, ITEM_SPOTS.length);
  const gap = Math.min(story.beat, (frame.scene.length - 1.2) / Math.max(items.length, 1));
  items.forEach((item, i) => {
    const appear = pop(frame, 0.4 + i * gap, 0.35);
    const [x, y] = ITEM_SPOTS[i];
    drawImageCentered(frame, item.icon, x, y, 120 * appear * (1 + 0.05 * frame.pulse), item.filter);
    if (appear > 0.5) drawLabel(ctx, item.label, x, y + 78);
  });
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.save();
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 28;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - 22, width, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#1f2a1f';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function distanceM(a: LatLon, b: LatLon) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** The way there: origin, the route up to the point nearest the park, then the park itself. */
function pathThere({ origin, destination, route }: StoryInput): LatLon[] {
  if (!route) return [origin, destination];
  const coords = route.coordinates.map(([lat, lon]) => ({ lat, lon }));
  const [dLat, dLon] = route.destinationOnPath;
  let nearest = 0;
  coords.forEach((point, i) => {
    if (distanceM(point, { lat: dLat, lon: dLon }) < distanceM(coords[nearest], { lat: dLat, lon: dLon })) nearest = i;
  });
  return [origin, ...coords.slice(0, nearest + 1), destination];
}

const MAP_BOX = { x: 50, y: 250, width: 620, height: 740 };

function project(points: LatLon[]) {
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const flat = points.map((point) => ({ x: point.lon * Math.cos((meanLat * Math.PI) / 180), y: -point.lat }));
  const xs = flat.map((point) => point.x);
  const ys = flat.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 90;
  const scale = Math.min((MAP_BOX.width - 2 * pad) / (maxX - minX || 1e-9), (MAP_BOX.height - 2 * pad) / (maxY - minY || 1e-9));
  const centerX = MAP_BOX.x + MAP_BOX.width / 2;
  const centerY = MAP_BOX.y + MAP_BOX.height / 2;
  return flat.map((point) => ({
    x: centerX + (point.x - (minX + maxX) / 2) * scale,
    y: centerY + (point.y - (minY + maxY) / 2) * scale,
  }));
}

function drawWalk(frame: Frame) {
  const { ctx, story, local, scene } = frame;
  const { input } = story;
  const byBike = input.bikeStation !== null;
  drawSky(frame);
  drawText(ctx, `${byBike ? 'Ride' : 'Walk'} to ${input.placeName}`, 100, { size: 52, scale: pop(frame), maxLines: 2 });

  ctx.save();
  ctx.fillStyle = '#eef4e4';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.roundRect(MAP_BOX.x, MAP_BOX.y, MAP_BOX.width, MAP_BOX.height, 36);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(MAP_BOX.x, MAP_BOX.y, MAP_BOX.width, MAP_BOX.height, 36);
  ctx.clip();
  ctx.strokeStyle = '#dde7d0';
  ctx.lineWidth = 10;
  for (let i = 1; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(MAP_BOX.x + i * 70 + 20 * Math.sin(i), MAP_BOX.y);
    ctx.lineTo(MAP_BOX.x + i * 70 - 20 * Math.sin(i), MAP_BOX.y + MAP_BOX.height);
    ctx.moveTo(MAP_BOX.x, MAP_BOX.y + i * 80);
    ctx.lineTo(MAP_BOX.x + MAP_BOX.width, MAP_BOX.y + i * 80 + 15 * Math.cos(i));
    ctx.stroke();
  }

  const points = project(pathThere(input));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  const progress = easeInOut(clamp01(local / (scene.length * 0.8)));
  const reached = total * progress;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(47, 107, 58, 0.25)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  points.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.stroke();

  let walker = points[0];
  ctx.strokeStyle = '#2f6b3a';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] <= reached) {
      ctx.lineTo(points[i].x, points[i].y);
      walker = points[i];
      continue;
    }
    const part = (reached - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    walker = { x: points[i - 1].x + (points[i].x - points[i - 1].x) * part, y: points[i - 1].y + (points[i].y - points[i - 1].y) * part };
    ctx.lineTo(walker.x, walker.y);
    break;
  }
  ctx.stroke();

  const start = points[0];
  const end = points[points.length - 1];
  ctx.fillStyle = '#2a6fdb';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2f6b3a';
  ctx.beginPath();
  ctx.arc(end.x, end.y, 18 * (1 + 0.15 * frame.pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawLabel(ctx, 'You', start.x, start.y + 44);
  if (byBike) drawEmoji(ctx, '🚲', walker.x, walker.y - 10, 72);
  drawAvatar(frame, walker.x, walker.y - (byBike ? 30 : 10), 80, 'bob');

  const { route } = input;
  const distance = route?.distanceM ?? 2 * distanceM(input.origin, input.destination);
  const km = ((distance / 1000) * progress).toFixed(1);
  if (!route) {
    drawText(ctx, `${km} km`, 1040, { size: 56 });
    drawText(ctx, byBike ? `round trip · bike from ${input.bikeStation?.name}` : 'round trip', 1115, {
      size: 32,
      weight: 600,
      maxLines: 2,
    });
    return;
  }
  drawText(ctx, `${km} km · ${Math.round(route.durationMin * progress)} min`, 1040, { size: 56 });
  const how =
    route.mode === 'bike'
      ? `${route.rideMin} min by bike from ${input.bikeStation?.name}, ${route.walkMin} on foot`
      : 'round trip on foot';
  drawText(ctx, how, 1115, { size: 32, weight: 600, maxLines: 2 });
}

function drawArrive(frame: Frame) {
  const { ctx, story, local, scene } = frame;
  drawSky(frame);
  drawPark(frame, 1 + (0.05 * local) / scene.length);
  drawWeather(frame);
  const walkIn = easeInOut(clamp01(local / (scene.length * 0.7)));
  drawAvatar(frame, -120 + walkIn * 480, 1160, 230, walkIn < 1 ? 'bob' : 'sway');
  const below = drawText(ctx, story.input.placeName, 170, { size: 72, scale: pop(frame), maxLines: 3 });
  drawText(ctx, 'You made it.', below + 24, { size: 40, weight: 600, scale: pop(frame, 0.3) });
}

const SCENE_EMOJI: Record<Exclude<ThingScene, 'sunset' | 'season'>, string> = {
  playground: '🛝',
  'sports field': '⚽',
  'running track': '👟',
  'outdoor gym': '💪',
  benches: '🪑',
  'drinking fountain': '💧',
  viewpoint: '🔭',
  water: '🦆',
  stretch: '🧘',
  photo: '📸',
  rest: '📖',
  walk: '🚶',
};
const SEASON_EMOJI: Record<Season, string> = { spring: '🌸', summer: '🌻', autumn: '🍂', winter: '❄️' };

function drawThing(frame: Frame) {
  const { ctx, story, local, scene } = frame;
  const thing = story.input.things[scene.index];
  const isSunset = thing.scene === 'sunset';
  const sinking = clamp01(local / scene.length);

  drawSky(frame, isSunset ? 0.5 + 0.5 * sinking : 0);
  if (isSunset) drawImageCentered(frame, '/fluent-emoji/sun_3d.png', 150, 640 + sinking * 150, 180);
  drawPark(frame, 1.05);
  drawWeather(frame);
  drawAvatar(frame, 240, 1140, 230, SCENE_MOTION[thing.scene]);

  const size = 190 * pop(frame, 0.15) * (1 + 0.08 * frame.pulse);
  const bounce = Math.sin(frame.time * 3) * 12;
  if (thing.scene === 'sunset') drawImageCentered(frame, '/fluent-emoji/sunset_3d.png', 520, 640 + bounce, size);
  else if (thing.scene === 'season') drawEmoji(ctx, SEASON_EMOJI[story.season], 520, 640 + bounce, size);
  else drawEmoji(ctx, SCENE_EMOJI[thing.scene], 520, 640 + bounce, size);

  const count = story.input.things.length;
  drawText(ctx, `Once you're there · ${scene.index + 1}/${count}`, 90, { size: 28, weight: 600 });
  drawText(ctx, thing.text, 145, { size: 54, scale: pop(frame), maxLines: 4 });
}

function drawEnding(frame: Frame) {
  const { ctx, story } = frame;
  drawSky(frame, story.sunsetAt ? 0.6 : 0);
  drawPark(frame);
  drawWeather(frame);
  // The end-screen buttons cover roughly the bottom quarter of the frame.
  drawAvatar(frame, WIDTH / 2, 930, 240, 'sway', pop(frame));
  const below = drawText(ctx, 'Ready when you are.', 140, { size: 66, scale: pop(frame) });
  const next = drawText(ctx, `Leave now · back by ${story.backBy}`, below + 30, { size: 40, weight: 700, scale: pop(frame, 0.3) });
  if (story.sunsetAt) drawText(ctx, `Sunset at ${story.sunsetAt}`, next + 16, { size: 34, weight: 600, scale: pop(frame, 0.5) });
}
