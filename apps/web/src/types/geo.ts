export interface LatLon {
  lat: number;
  lon: number;
}

export interface NamedPoint extends LatLon {
  name: string;
}
