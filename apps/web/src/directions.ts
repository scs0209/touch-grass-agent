type LatLon = { lat: number; lon: number };

/** Google Maps directions; a bike trip goes through the station where the bike is rented. */
export function directionsUrl(destination: LatLon, bikeStation: LatLon | null = null) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lon}`,
    travelmode: bikeStation ? 'bicycling' : 'walking',
  });
  if (bikeStation) params.set('waypoints', `${bikeStation.lat},${bikeStation.lon}`);
  return `https://www.google.com/maps/dir/?${params}`;
}
