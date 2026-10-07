import { EMOJI_FILES, ICON_FILTERS } from '../constants/outfit';
import { messages } from '../i18n';
import type { Outfit, OutfitItem } from '../types/outfit';

export function outfitItems(outfit: Outfit): OutfitItem[] {
  const labels = messages().outfit.items;
  const keys = [outfit.outer === 'none' ? null : outfit.outer, outfit.top, outfit.bottom, ...outfit.extras].filter(
    (item) => item !== null,
  );
  return keys.map((key) => ({
    key,
    label: labels[key],
    icon: `/fluent-emoji/${EMOJI_FILES[key]}_3d.png`,
    filter: ICON_FILTERS[key],
  }));
}
