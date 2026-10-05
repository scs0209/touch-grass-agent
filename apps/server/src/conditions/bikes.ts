import { distanceInMeters } from '../geo.js';

export interface BikeStation {
  id: string;
  name: string;
  bikesAvailable: number;
  distanceMeters: number;
  lat: number;
  lon: number;
}

interface SeoulBikeResponse {
  rentBikeStatus?: {
    row: {
      stationId: string;
      stationName: string;
      parkingBikeTotCnt: string;
      stationLatitude: string;
      stationLongitude: string;
    }[];
  };
}

const SEARCH_RADIUS_M = 500;
const PAGE_SIZE = 1000;
const PAGE_COUNT = 4;

function isInSeoul(lat: number, lon: number) {
  return lat >= 37.4 && lat <= 37.72 && lon >= 126.76 && lon <= 127.19;
}

async function fetchPage(apiKey: string, page: number) {
  const start = page * PAGE_SIZE + 1;
  const end = start + PAGE_SIZE - 1;
  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(apiKey)}/json/bikeList/${start}/${end}/`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Seoul bike API failed: ${response.status}`);
  const text = await response.text();

  let data: SeoulBikeResponse | null = null;
  try {
    data = JSON.parse(text) as SeoulBikeResponse;
  } catch {
    // Errors (bad key, out-of-range page) come back as XML even when JSON is requested.
  }

  if (data?.rentBikeStatus) return data.rentBikeStatus.row;
  if (page === 0) throw new Error(`Seoul bike API error: ${text.slice(0, 200)}`);
  return [];
}

/** Returns null when bike data does not apply (no API key or outside Seoul). */
export async function getNearbyBikeStations(lat: number, lon: number): Promise<BikeStation[] | null> {
  const apiKey = process.env.SEOUL_OPEN_API_KEY;
  if (!apiKey || !isInSeoul(lat, lon)) return null;

  const pages = await Promise.all(Array.from({ length: PAGE_COUNT }, (_, page) => fetchPage(apiKey, page)));

  return pages
    .flat()
    .map((row) => {
      const stationLat = Number(row.stationLatitude);
      const stationLon = Number(row.stationLongitude);
      return {
        id: row.stationId,
        name: row.stationName,
        bikesAvailable: Number(row.parkingBikeTotCnt),
        distanceMeters: Math.round(distanceInMeters({ lat, lon }, { lat: stationLat, lon: stationLon })),
        lat: stationLat,
        lon: stationLon,
      };
    })
    .filter((station) => station.distanceMeters <= SEARCH_RADIUS_M)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}
