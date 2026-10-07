import { useEffect, useState } from 'react';
import { fetchStreetAddress } from '../services/api';
import type { LatLon } from '../types/geo';

/** The street address of a point, looked up only while `point` is set; null until it arrives or when there is none. */
export function useStreetAddress(point: LatLon | null) {
  const [address, setAddress] = useState<string | null>(null);
  const lat = point?.lat;
  const lon = point?.lon;

  useEffect(() => {
    setAddress(null);
    if (lat === undefined || lon === undefined) return;
    const controller = new AbortController();
    void fetchStreetAddress({ lat, lon }, controller.signal).then((found) => {
      if (!controller.signal.aborted) setAddress(found);
    });
    return () => controller.abort();
  }, [lat, lon]);

  return address;
}
