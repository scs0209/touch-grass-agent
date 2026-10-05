import { z } from 'zod';
import type { AirQuality } from './conditions/airQuality.js';
import type { Weather } from './conditions/weather.js';

export const TOPS = ['tshirt', 'longsleeve', 'knit', 'hoodie'] as const;
export const BOTTOMS = ['shorts', 'pants'] as const;
export const OUTERS = ['none', 'light_jacket', 'trench', 'coat', 'padded'] as const;
export const EXTRAS = ['umbrella', 'mask', 'cap', 'sunglasses', 'scarf', 'gloves'] as const;

export const outfitSchema = z.object({
  top: z.enum(TOPS),
  bottom: z.enum(BOTTOMS),
  outer: z.enum(OUTERS),
  extras: z.array(z.enum(EXTRAS)).default([]),
  tip: z.string().min(1),
});

export type Outfit = z.infer<typeof outfitSchema>;
type Layers = Pick<Outfit, 'top' | 'bottom' | 'outer'>;

/** Feels-like temperature bands from the Korean "기온별 옷차림" chart, warmest first. */
const LAYER_BANDS: { minFeelsLikeC: number; layers: Layers }[] = [
  { minFeelsLikeC: 28, layers: { top: 'tshirt', bottom: 'shorts', outer: 'none' } },
  { minFeelsLikeC: 23, layers: { top: 'tshirt', bottom: 'pants', outer: 'none' } },
  { minFeelsLikeC: 20, layers: { top: 'longsleeve', bottom: 'pants', outer: 'none' } },
  { minFeelsLikeC: 17, layers: { top: 'hoodie', bottom: 'pants', outer: 'none' } },
  { minFeelsLikeC: 12, layers: { top: 'knit', bottom: 'pants', outer: 'light_jacket' } },
  { minFeelsLikeC: 9, layers: { top: 'longsleeve', bottom: 'pants', outer: 'trench' } },
  { minFeelsLikeC: 5, layers: { top: 'knit', bottom: 'pants', outer: 'coat' } },
  { minFeelsLikeC: -Infinity, layers: { top: 'hoodie', bottom: 'pants', outer: 'padded' } },
];

/** Extras that conditions demand regardless of style choices. */
function requiredExtras(weather: Weather, airQuality: AirQuality): Outfit['extras'] {
  const extras: Outfit['extras'] = [];
  if (weather.maxPrecipitationChanceNext3h >= 50 || weather.precipitationMm > 0) extras.push('umbrella');
  if (['poor', 'very poor', 'extremely poor'].includes(airQuality.level)) extras.push('mask');
  if (weather.uvIndex >= 6) extras.push('cap', 'sunglasses');
  if (weather.feelsLikeC <= 5) extras.push('scarf', 'gloves');
  return extras;
}

export function baselineOutfit(weather: Weather, airQuality: AirQuality): Outfit {
  const { layers } = LAYER_BANDS.find((band) => weather.feelsLikeC >= band.minFeelsLikeC)!;
  return {
    ...layers,
    extras: requiredExtras(weather, airQuality),
    tip: `Feels like ${Math.round(weather.feelsLikeC)}°C out there.`,
  };
}

/** Keeps the model's style choices but never drops an extra the conditions require. */
export function withRequiredExtras(outfit: Outfit, weather: Weather, airQuality: AirQuality): Outfit {
  return { ...outfit, extras: [...new Set([...outfit.extras, ...requiredExtras(weather, airQuality)])] };
}

export type Fit = 'cold' | 'normal' | 'warm';

export interface OutfitOption {
  fit: Fit;
  outfit: Outfit;
}

const sameLayers = (a: Layers, b: Layers) => a.top === b.top && a.bottom === b.bottom && a.outer === b.outer;

/**
 * The chosen outfit plus one band colder ("runs cold") and one band warmer ("runs warm").
 * A neighbor is dropped at the ends of the chart or when it would repeat the chosen layers.
 */
export function outfitOptions(chosen: Outfit, weather: Weather, airQuality: AirQuality): OutfitOption[] {
  const bandIndex = LAYER_BANDS.findIndex((band) => weather.feelsLikeC >= band.minFeelsLikeC);
  const extras = requiredExtras(weather, airQuality);

  const neighbor = (index: number, tip: string): Outfit | null => {
    const band = LAYER_BANDS[index];
    if (!band || sameLayers(band.layers, chosen)) return null;
    return { ...band.layers, extras, tip };
  };

  const options: { fit: Fit; outfit: Outfit | null }[] = [
    { fit: 'cold', outfit: neighbor(bandIndex + 1, 'If you run cold, go one layer warmer.') },
    { fit: 'normal', outfit: chosen },
    { fit: 'warm', outfit: neighbor(bandIndex - 1, 'If you run warm, go one layer lighter.') },
  ];
  return options.filter((option): option is OutfitOption => option.outfit !== null);
}
