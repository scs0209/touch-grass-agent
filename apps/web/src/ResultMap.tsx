import { divIcon, type FitBoundsOptions } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import type { Route } from './previewDraw';

type LatLngTuple = [number, number];

interface Point {
  name: string;
  lat: number;
  lon: number;
}

interface ResultMapProps {
  origin: { lat: number; lon: number };
  place: Point | null;
  route: Pick<Route, 'coordinates' | 'destinationOnPath' | 'rideRange'> | null;
  bikeStation: Point | null;
}

const DEFAULT_ZOOM = 15;
const ROUTE_COLOR = '#2f6b3a';

/** Extra top padding leaves room for the destination's permanent tooltip. */
const CARD_MAP_PADDING: FitBoundsOptions = { paddingTopLeft: [24, 48], paddingBottomRight: [24, 24] };
/** Also keeps the route clear of the close button and the caption, with room for centered name tooltips at the sides. */
const FULL_MAP_PADDING: FitBoundsOptions = { paddingTopLeft: [90, 80], paddingBottomRight: [90, 120] };

/** Sits just above the station so a station next to "You are here" doesn't hide it. */
const bikeIcon = divIcon({ className: 'bike-marker', html: '🚲', iconSize: [28, 28], iconAnchor: [14, 34] });

/** Bounds fitting puts the station near the map's edge on the side away from the park, so its name faces the park. */
const STATION_LABEL = {
  left: { direction: 'left', offset: [-12, -20] },
  right: { direction: 'right', offset: [12, -20] },
} as const;

function stationLabel(station: Point, place: Point | null) {
  if (place && station.lon > place.lon) return STATION_LABEL.left;
  return STATION_LABEL.right;
}

/** On a bike trip the walks to and from the station are dashed and the ride is solid. */
function routeParts({ coordinates, rideRange }: NonNullable<ResultMapProps['route']>) {
  if (!rideRange) return [{ positions: coordinates, walking: false }];
  const [rideStart, rideEnd] = rideRange;
  return [
    { positions: coordinates.slice(0, rideStart + 1), walking: true },
    { positions: coordinates.slice(rideStart, rideEnd + 1), walking: false },
    { positions: coordinates.slice(rideEnd), walking: true },
  ];
}

/** The map on the result card, with a button that opens it over the whole screen. */
export function ResultMap({ caption, ...props }: ResultMapProps & { caption: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  return (
    <>
      <div className="map-frame">
        <RouteMap {...props} expanded={false} />
        <button className="map-expand" onClick={() => setExpanded(true)} aria-label="Show the map full screen">
          ⤢ Full map
        </button>
      </div>
      {/* The card's backdrop-filter would trap a fixed overlay inside the card, so it renders on body. */}
      {expanded &&
        createPortal(
          <div className="map-backdrop" role="dialog" aria-modal="true" aria-label={`Map to ${props.place?.name ?? 'your destination'}`}>
            <RouteMap {...props} expanded />
            <button ref={closeRef} className="map-close" onClick={() => setExpanded(false)} aria-label="Close the full map">
              ✕
            </button>
            {caption && <p className="map-caption">{caption}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}

function RouteMap({ origin, place, route, bikeStation, expanded }: ResultMapProps & { expanded: boolean }) {
  const originPoint: LatLngTuple = [origin.lat, origin.lon];
  const points: LatLngTuple[] = [
    originPoint,
    ...(route?.coordinates ?? []),
    ...[place, bikeStation].filter((point) => point !== null).map((point): LatLngTuple => [point.lat, point.lon]),
  ];
  const boundsOptions = expanded ? FULL_MAP_PADDING : CARD_MAP_PADDING;
  const viewport = points.length > 1 ? { bounds: points, boundsOptions } : { center: originPoint, zoom: DEFAULT_ZOOM };

  return (
    <MapContainer
      className={expanded ? 'map map-full' : 'map'}
      scrollWheelZoom={expanded}
      zoomSnap={expanded ? 0.25 : 1}
      {...viewport}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {route &&
        routeParts(route).map(({ positions, walking }, index) => (
          <Polyline
            key={index}
            positions={positions}
            pathOptions={
              walking
                ? { color: ROUTE_COLOR, weight: 4, opacity: 0.9, dashArray: '2 8' }
                : { color: ROUTE_COLOR, weight: 5, opacity: 0.8 }
            }
          />
        ))}
      {route && place && (
        <Polyline
          positions={[
            [originPoint, route.coordinates[0]],
            [[place.lat, place.lon], route.destinationOnPath],
          ]}
          pathOptions={{ color: ROUTE_COLOR, weight: 3, dashArray: '4 6' }}
        />
      )}
      <Pane name="origin" style={{ zIndex: 650 }}>
        <CircleMarker center={originPoint} radius={8} pathOptions={{ color: '#fff', fillColor: '#2a6fdb', fillOpacity: 1 }}>
          <Tooltip>You are here</Tooltip>
        </CircleMarker>
      </Pane>
      {place && (
        <CircleMarker
          center={[place.lat, place.lon]}
          radius={9}
          pathOptions={{ color: '#fff', fillColor: ROUTE_COLOR, fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top">
            {place.name}
          </Tooltip>
        </CircleMarker>
      )}
      {bikeStation && (
        <Marker position={[bikeStation.lat, bikeStation.lon]} icon={bikeIcon}>
          <Tooltip permanent {...stationLabel(bikeStation, place)}>
            {bikeStation.name}
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
