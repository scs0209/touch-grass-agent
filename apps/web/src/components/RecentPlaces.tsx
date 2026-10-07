import type { RecentPlace } from '../types/places';
import { describeRecentPlace } from '../utils/places';

interface RecentPlacesProps {
  places: RecentPlace[];
  disabled: boolean;
  onPick: (place: RecentPlace) => void;
  onRemove: (place: RecentPlace) => void;
}

export function RecentPlaces({ places, disabled, onPick, onRemove }: RecentPlacesProps) {
  return (
    <section className="panel recent-places" aria-labelledby="recent-places-title">
      <h2 id="recent-places-title">Recent places</h2>
      {places.length === 0 ? (
        <p className="muted small">Places you get suggested show up here, so you can pick one again later.</p>
      ) : (
        <ul>
          {places.map((place) => (
            <li key={`${place.name}-${place.lat}-${place.lon}`}>
              <button className="recent-pick" onClick={() => onPick(place)} disabled={disabled} type="button">
                <span className="recent-name">{place.name}</span>
                <span className="muted small">{describeRecentPlace(place)}</span>
              </button>
              <button
                className="recent-remove"
                onClick={() => onRemove(place)}
                aria-label={`Remove ${place.name} from recent places`}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
