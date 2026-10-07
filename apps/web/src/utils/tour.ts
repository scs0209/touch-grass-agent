import type { Box } from '../types/tour';

const GAP = 14;
const MARGIN = 16;
/** Keeps the arrow off the card's rounded corners. */
const ARROW_INSET = 24;

type Size = { width: number; height: number };

/** Covers the whole screen except the box, so taps inside the box reach the page under it. */
export function clipOutside({ top, left, width, height }: Box) {
  const right = left + width;
  const bottom = top + height;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the step's card goes: under the element if it fits, else above it, else over the bottom of the screen
 * without an arrow (an element taller than the screen leaves no room on either side).
 */
export function placeTooltip(target: Box, tooltip: Size, viewport: Size) {
  const center = target.left + target.width / 2;
  const left = clamp(center - tooltip.width / 2, MARGIN, viewport.width - tooltip.width - MARGIN);
  const arrowX = clamp(center - left, ARROW_INSET, tooltip.width - ARROW_INSET);
  const below = target.top + target.height + GAP;
  if (below + tooltip.height <= viewport.height - MARGIN) return { side: 'below', top: below, left, arrowX } as const;
  const above = target.top - GAP - tooltip.height;
  if (above >= MARGIN) return { side: 'above', top: above, left, arrowX } as const;
  return { side: 'over', top: viewport.height - tooltip.height - MARGIN, left, arrowX } as const;
}
