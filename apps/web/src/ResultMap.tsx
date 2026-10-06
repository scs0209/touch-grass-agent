import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

/** Sits just above the station so a station next to "You are here" doesn't hide it. */
const bikeIcon = divIcon({ className: 'bike-marker', html: '🚲', iconSize: [28, 28], iconAnchor: [14, 34] });

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

export function ResultMap({ origin, place, route, bikeStation }: ResultMapProps) {
  const originPoint: LatLngTuple = [origin.lat, origin.lon];
  const points: LatLngTuple[] = [
    originPoint,
    ...(route?.coordinates ?? []),
    ...[place, bikeStation].filter((point) => point !== null).map((point): LatLngTuple => [point.lat, point.lon]),
  ];
  const viewport =
    points.length > 1
      ? {
          bounds: points,
          // Extra top padding leaves room for the destination's permanent tooltip.
          boundsOptions: { paddingTopLeft: [24, 48] as [number, number], paddingBottomRight: [24, 24] as [number, number] },
        }
      : { center: originPoint, zoom: DEFAULT_ZOOM };

  return (
    <MapContainer className="map" scrollWheelZoom={false} {...viewport}>
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
          <Tooltip permanent direction="right" offset={[12, -20]}>
            {bikeStation.name}
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
