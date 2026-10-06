import { EMOJI_FILES, ICON_FILTERS, OUTFIT_LABELS } from '../constants/outfit';
import type { Outfit, OutfitItem } from '../types/outfit';

export function outfitItems(outfit: Outfit): OutfitItem[] {
  const keys = [outfit.outer === 'none' ? null : outfit.outer, outfit.top, outfit.bottom, ...outfit.extras].filter(
    (item) => item !== null,
  );
  return keys.map((key) => ({
    key,
    label: OUTFIT_LABELS[key],
    icon: `/fluent-emoji/${EMOJI_FILES[key]}_3d.png`,
    filter: ICON_FILTERS[key],
  }));
}
