import type { Bottom, Extra, Fit, Outer, OutfitPiece, Top } from '../types/outfit';

export const OUTFIT_LABELS: Record<Top | Bottom | Outer | Extra, string> = {
  tshirt: 'T-shirt',
  longsleeve: 'Long-sleeve tee',
  knit: 'Knit sweater',
  hoodie: 'Hoodie',
  shorts: 'Shorts',
  pants: 'Long pants',
  none: 'No outer layer',
  light_jacket: 'Light jacket',
  trench: 'Trench coat',
  coat: 'Wool coat',
  padded: 'Puffer jacket',
  umbrella: 'Umbrella',
  mask: 'Mask',
  cap: 'Cap',
  sunglasses: 'Sunglasses',
  scarf: 'Scarf',
  gloves: 'Gloves',
};

export const FIT_LABELS: Record<Fit, string> = {
  cold: 'Runs cold',
  normal: 'Just right',
  warm: 'Runs warm',
};

/** Fluent Emoji has no hoodie, long-sleeve, or per-style jacket icons, so those share the closest one (see ICON_FILTERS). */
export const EMOJI_FILES: Record<OutfitPiece, string> = {
  tshirt: 't-shirt',
  longsleeve: 't-shirt',
  knit: 'yarn',
  hoodie: 't-shirt',
  shorts: 'shorts',
  pants: 'jeans',
  light_jacket: 'coat',
  trench: 'coat',
  coat: 'coat',
  padded: 'coat',
  umbrella: 'umbrella',
  mask: 'face_with_medical_mask',
  cap: 'billed_cap',
  sunglasses: 'sunglasses',
  scarf: 'scarf',
  gloves: 'gloves',
};

/** Tints shared icons toward the matching avatar color so each item still reads differently. */
export const ICON_FILTERS: Partial<Record<OutfitPiece, string>> = {
  tshirt: 'hue-rotate(95deg)',
  hoodie: 'grayscale(1) brightness(0.85)',
  light_jacket: 'hue-rotate(185deg) saturate(1.2) brightness(0.7)',
  coat: 'grayscale(1) brightness(0.45) contrast(1.1)',
  padded: 'hue-rotate(165deg) saturate(0.9) brightness(0.5)',
};
