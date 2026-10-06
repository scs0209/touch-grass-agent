import { type ExpressionSpecification, Map as MapLibre, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { LatLon } from '../types/geo';

setWorkerUrl(workerUrl);

/** Free OpenStreetMap vector tiles with 3D building heights, no key needed. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const PIXEL_RATIO = 2;
const STYLE_WAIT_MS = 10000;
/** Per camera stop while warming the tile cache; a slow stop just shows its tiles a moment late. */
const STOP_WAIT_MS = 2500;
const WARM_UP_WAIT_MS = 12000;

/** Minor shop icons, road shields, and one-way arrows clutter a film; main places and transit stay. */
const HIDDEN_LAYERS = [
  'poi_r20',
  'poi_r7',
  'road_one_way_arrow',
  'road_one_way_arrow_opposite',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
];

const ROUTE_DONE = '#34c759';
const ROUTE_AHEAD = 'rgba(52, 199, 89, 0.35)';

export interface MapCamera {
  center: LatLon;
  zoom: number;
  pitch: number;
  bearing: number;
  /** CSS pixels of top padding; pushes the center down the frame, leaving room ahead. */
  lift: number;
}

/** Colors for the time of day and weather. */
export interface MapLook {
  sky: string;
  horizon: string;
  fog: string;
  buildings: string;
}

export interface FlyoverMap {
  /** Renders the map now from `camera`, with the first `traveled` (0 to 1) of the route lit up. */
  render(camera: MapCamera, traveled: number): HTMLCanvasElement;
  /** Canvas pixels of a point under the last rendered camera. */
  project(point: LatLon): { x: number; y: number };
  dispose(): void;
}

interface Options {
  path: LatLon[];
  width: number;
  height: number;
  look: MapLook;
  /** Cameras the film will pass through, visited once so their tiles are cached before playback. */
  stops: MapCamera[];
  signal: AbortSignal;
}

const toCenter = ({ lat, lon }: LatLon): [number, number] => [lon, lat];

const waitFor = (map: MapLibre, event: 'style.load' | 'idle', ms: number) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    map.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

function traveledLine(traveled: number): ExpressionSpecification {
  return ['step', ['line-progress'], ROUTE_DONE, Math.min(Math.max(traveled, 0), 1), ROUTE_AHEAD];
}

function restyle(map: MapLibre, look: MapLook) {
  for (const id of HIDDEN_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  if (map.getLayer('building')) map.setPaintProperty('building', 'fill-color', look.buildings);
  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-color', look.buildings);
    // Lets the street show faintly through a tower between the camera and the walker.
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.88);
  }
  // Anchored to the map, so building faces brighten and darken as the camera circles them.
  map.setLight({ anchor: 'map', intensity: 0.5 });
  map.setSky({
    'sky-color': look.sky,
    'horizon-color': look.horizon,
    'fog-color': look.fog,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.4,
  });
}

function addRoute(map: MapLibre, path: LatLon[]) {
  map.addSource('route', {
    type: 'geojson',
    lineMetrics: true,
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path.map(toCenter) } },
  });
  // Above the 3D buildings so the way stays visible behind corners, below the street names.
  const layers = map.getStyle().layers;
  const buildings = layers.findIndex((layer) => layer.id === 'building-3d');
  const firstLabel = layers.find((layer, i) => i > buildings && layer.type === 'symbol')?.id;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  map.addLayer(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: round,
      paint: { 'line-color': 'rgba(255, 255, 255, 0.9)', 'line-width': 13 },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: round,
      paint: { 'line-width': 7, 'line-gradient': traveledLine(0) },
    },
    firstLabel,
  );
}

/**
 * Opens a hidden 3D map of the trip and warms its tile cache. Throws when WebGL or the map style is
 * unavailable, so the preview can fall back to the illustrated story.
 */
export async function openFlyoverMap({ path, width, height, look, stops, signal }: Options): Promise<FlyoverMap> {
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: `${width / PIXEL_RATIO}px`,
    height: `${height / PIXEL_RATIO}px`,
    pointerEvents: 'none',
  });
  document.body.append(container);

  let map: MapLibre | null = null;
  const dispose = () => {
    map?.remove();
    map = null;
    container.remove();
  };

  try {
    // Fetched here rather than by MapLibre, so an unreachable tile server fails at once instead of timing out.
    const response = await fetch(STYLE_URL, { signal: AbortSignal.any([signal, AbortSignal.timeout(STYLE_WAIT_MS)]) });
    if (!response.ok) throw new Error(`Map style failed: ${response.status}`);
    const style = await response.json();

    const first = stops[0];
    map = new MapLibre({
      container,
      style,
      center: toCenter(first.center),
      zoom: first.zoom,
      pitch: first.pitch,
      bearing: first.bearing,
      interactive: false,
      attributionControl: false,
      pixelRatio: PIXEL_RATIO,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      fadeDuration: 0,
      maxPitch: 70,
      maxTileCacheSize: 800,
      renderWorldCopies: false,
    });
    // Not 'load', which also waits for every first tile; slow tiles only use up the warm-up time below.
    if (!(await waitFor(map, 'style.load', STYLE_WAIT_MS)) || signal.aborted) throw new Error('Map style did not load');

    restyle(map, look);
    addRoute(map, path);

    const giveUpAt = Date.now() + WARM_UP_WAIT_MS;
    for (const stop of stops) {
      if (signal.aborted) throw new Error('Preview closed');
      if (Date.now() > giveUpAt) break;
      map.jumpTo({
        center: toCenter(stop.center),
        zoom: stop.zoom,
        pitch: stop.pitch,
        bearing: stop.bearing,
        padding: { top: stop.lift, bottom: 0, left: 0, right: 0 },
      });
      await waitFor(map, 'idle', STOP_WAIT_MS);
    }
    if (signal.aborted) throw new Error('Preview closed');
  } catch (error) {
    dispose();
    throw error;
  }

  let litUpTo = -1;
  return {
    render(camera, traveled) {
      const live = map!;
      live.jumpTo({
        center: toCenter(camera.center),
        zoom: camera.zoom,
        pitch: camera.pitch,
        bearing: camera.bearing,
        padding: { top: camera.lift, bottom: 0, left: 0, right: 0 },
      });
      const rounded = Math.round(traveled * 1000) / 1000;
      if (rounded !== litUpTo) {
        live.setPaintProperty('route-line', 'line-gradient', traveledLine(rounded));
        litUpTo = rounded;
      }
      live.redraw();
      return live.getCanvas();
    },
    project(point) {
      const { x, y } = map!.project(toCenter(point));
      return { x: x * PIXEL_RATIO, y: y * PIXEL_RATIO };
    },
    dispose,
  };
}
