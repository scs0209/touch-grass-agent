import type { Outfit } from '../types/outfit';
import { outfitItems } from '../utils/outfit';

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
