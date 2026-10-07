import type { Box } from '../types/tour';

const GAP = 14;
const MARGIN = 16;
/** Keeps the arrow off the card's rounded corners. */
const ARROW_INSET = 24;

type Size = { width: number; height: number };

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
