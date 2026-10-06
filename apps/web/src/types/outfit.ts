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

/** How warm a person usually feels; the server sends one outfit per fit. */
export type Fit = 'cold' | 'normal' | 'warm';

/** Everything that can be worn; "none" means no outer layer, so it has no card or icon. */
export type OutfitPiece = Exclude<Top | Bottom | Outer | Extra, 'none'>;

export interface OutfitItem {
  key: OutfitPiece;
  label: string;
  icon: string;
  filter?: string;
}
