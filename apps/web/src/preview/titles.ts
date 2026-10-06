import { clamp01, FONT, wrapLines } from './canvas';

export interface TitleLine {
  text: string;
  size: number;
  weight: number;
  alpha: number;
  gapAfter: number;
}

export interface TitleStyle {
  kicker: number;
  title: number;
  sub: number;
  maxWidth: number;
  titleLines: number;
}

/** Each word starts this long after the one before it. */
const WORD_STAGGER = 0.045;
const WORD_SEC = 0.4;
/** How far a word rises into place. */
const WORD_RISE = 22;

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x ** 3;
export const easeOutBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

export function titleLines(
  ctx: CanvasRenderingContext2D,
  text: { kicker?: string; title: string; sub?: string },
  style: TitleStyle,
): TitleLine[] {
  const lines: TitleLine[] = [];
  const add = (value: string, size: number, weight: number, alpha: number, maxLines: number, gapAfter: number) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const wrapped = wrapLines(ctx, value, style.maxWidth).slice(0, maxLines);
    wrapped.forEach((part, i) => {
      lines.push({ text: part, size, weight, alpha, gapAfter: i === wrapped.length - 1 ? gapAfter : size * 0.18 });
    });
  };
  if (text.kicker) add(text.kicker.toUpperCase(), style.kicker, 600, 0.82, 1, 18);
  add(text.title, style.title, 700, 1, style.titleLines, 20);
  if (text.sub) add(text.sub, style.sub, 500, 0.9, 2, 0);
  return lines;
}

export const linesHeight = (lines: TitleLine[]) => lines.reduce((sum, line) => sum + line.size + line.gapAfter, 0);

/** When the last word has finished rising in, in seconds after the reveal starts. */
export const revealDuration = (lines: TitleLine[]) =>
  Math.max(0, lines.reduce((count, line) => count + line.text.split(' ').length, 0) - 1) * WORD_STAGGER + WORD_SEC;

/**
 * Draws lines word by word, each rising into place, so a title reads as it appears instead of
 * popping in as one block. `elapsed` is the time since the reveal started; `fade` scales the whole block.
 */
export function drawReveal(
  ctx: CanvasRenderingContext2D,
  lines: TitleLine[],
  at: { x: number; y: number; align: 'left' | 'center' },
  elapsed: number,
  fade: number,
) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 2;
  let y = at.y;
  let index = 0;
  for (const line of lines) {
    ctx.font = `${line.weight} ${line.size}px ${FONT}`;
    const words = line.text.split(' ');
    const space = ctx.measureText(' ').width;
    const widths = words.map((word) => ctx.measureText(word).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + space * (words.length - 1);
    let x = at.align === 'center' ? at.x - total / 2 : at.x;
    words.forEach((word, i) => {
      const shown = easeOutCubic(clamp01((elapsed - index * WORD_STAGGER) / WORD_SEC));
      index++;
      if (shown > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${line.alpha * shown * fade})`;
        ctx.fillText(word, x, y + (1 - shown) * WORD_RISE);
      }
      x += widths[i] + space;
    });
    y += line.size + line.gapAfter;
  }
  ctx.restore();
}

/** A line that draws out from the middle, then catches one glint of light across it. */
export function drawUnderline(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  width: number,
  elapsed: number,
  fade: number,
  color: string,
) {
  const grown = easeOutCubic(clamp01(elapsed / 0.7));
  if (grown <= 0) return;
  const length = width * grown;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.roundRect(center.x - length / 2, center.y - 3, length, 6, 3);
  ctx.fill();

  const glint = clamp01((elapsed - 0.9) / 0.9);
  if (glint > 0 && glint < 1) {
    const x = center.x - width / 2 - 80 + (width + 160) * easeOutCubic(glint);
    const shine = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shine.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.roundRect(center.x - length / 2, center.y - 3, length, 6, 3);
    ctx.fill();
  }
  ctx.restore();
}

/** Small rounded labels in a centered row, popping in one after another. */
export function drawChips(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  center: { x: number; y: number },
  elapsed: number,
  fade: number,
) {
  ctx.save();
  ctx.font = `600 34px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padding = 28;
  const gap = 18;
  const height = 68;
  const widths = labels.map((label) => ctx.measureText(label).width + padding * 2);
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (labels.length - 1);
  const fit = Math.min(1, (center.x - 60) / (total / 2));
  ctx.translate(center.x, center.y);
  ctx.scale(fit, fit);
  ctx.translate(-center.x, -center.y);
  let x = center.x - total / 2;
  labels.forEach((label, i) => {
    const shown = clamp01((elapsed - i * 0.12) / 0.45);
    const width = widths[i];
    if (shown > 0) {
      const scale = 0.8 + 0.2 * easeOutBack(shown);
      ctx.save();
      ctx.translate(x + width / 2, center.y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = easeOutCubic(shown) * fade;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-width / 2, -height / 2, width, height, height / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8;
      ctx.fillText(label, 0, 2);
      ctx.restore();
    }
    x += width + gap;
  });
  ctx.restore();
}
