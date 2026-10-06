export function walkingDirectionsUrl(destination: { lat: number; lon: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lon}&travelmode=walking`;
}
