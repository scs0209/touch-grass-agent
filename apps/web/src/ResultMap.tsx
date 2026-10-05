import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';

type LatLngTuple = [number, number];

interface Point {
  name: string;
  lat: number;
  lon: number;
}

interface ResultMapProps {
  origin: { lat: number; lon: number };
  place: Point | null;
  route: { coordinates: LatLngTuple[]; destinationOnPath: LatLngTuple } | null;
  bikeStation: Point | null;
}

const DEFAULT_ZOOM = 15;

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
      {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#2f6b3a', weight: 5, opacity: 0.8 }} />}
      {route && place && (
        <Polyline
          positions={[
            [originPoint, route.coordinates[0]],
            [[place.lat, place.lon], route.destinationOnPath],
          ]}
          pathOptions={{ color: '#2f6b3a', weight: 3, dashArray: '4 6' }}
        />
      )}
      <CircleMarker center={originPoint} radius={8} pathOptions={{ color: '#fff', fillColor: '#2a6fdb', fillOpacity: 1 }}>
        <Tooltip>You are here</Tooltip>
      </CircleMarker>
      {place && (
        <CircleMarker
          center={[place.lat, place.lon]}
          radius={9}
          pathOptions={{ color: '#fff', fillColor: '#2f6b3a', fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top">
            {place.name}
          </Tooltip>
        </CircleMarker>
      )}
      {bikeStation && (
        <CircleMarker
          center={[bikeStation.lat, bikeStation.lon]}
          radius={7}
          pathOptions={{ color: '#fff', fillColor: '#e0892f', fillOpacity: 1 }}
        >
          <Tooltip>{bikeStation.name}</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
