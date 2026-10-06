export type Top = 'tshirt' | 'longsleeve' | 'knit' | 'hoodie';
export type Bottom = 'shorts' | 'pants';
export type Outer = 'none' | 'light_jacket' | 'trench' | 'coat' | 'padded';
export type Extra = 'umbrella' | 'mask' | 'cap' | 'sunglasses' | 'scarf' | 'gloves';

export interface Outfit {
  top: Top;
  bottom: Bottom;
  outer: Outer;
  extras: Extra[];
  tip: string;
}

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

/** Fluent Emoji has no hoodie, long-sleeve, or per-style jacket icons, so those share the closest one (see ICON_FILTERS). */
const EMOJI_FILES: Record<Exclude<keyof typeof OUTFIT_LABELS, 'none'>, string> = {
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
const ICON_FILTERS: Partial<Record<keyof typeof EMOJI_FILES, string>> = {
  tshirt: 'hue-rotate(95deg)',
  hoodie: 'grayscale(1) brightness(0.85)',
  light_jacket: 'hue-rotate(185deg) saturate(1.2) brightness(0.7)',
  coat: 'grayscale(1) brightness(0.45) contrast(1.1)',
  padded: 'hue-rotate(165deg) saturate(0.9) brightness(0.5)',
};

export interface OutfitItem {
  key: keyof typeof EMOJI_FILES;
  label: string;
  icon: string;
  filter?: string;
}

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

export function OutfitCards({ outfit }: { outfit: Outfit }) {
  return (
    <ul className="outfit-cards">
      {outfitItems(outfit).map((item) => (
        <li key={item.key} className="outfit-card">
          <img src={item.icon} alt="" width={44} height={44} style={{ filter: item.filter }} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
