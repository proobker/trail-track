import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { MODE_META, MODES, type Journey } from '../model/types';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const modeColor: ExpressionSpecification = ['match', ['get', 'mode'], ...MODES.flatMap((m) => [m, MODE_META[m].color]), '#ffffff'] as unknown as ExpressionSpecification;
const SOLID = MODES.filter((m) => !MODE_META[m].dash);
const DASHED = MODES.filter((m) => MODE_META[m].dash);

/** Animated "flowing ants" dash sequence, cycled when the trail is idle. */
export const FLOW_STEPS: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

export function trailData(j?: Journey): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: (j?.segments ?? []).map((s) => ({ type: 'Feature', properties: { id: s.id, mode: s.mode, routing: s.routing }, geometry: s.geometry })),
  };
}

export function stopsData(j?: Journey): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: (j?.stops ?? []).map((s, i) => ({ type: 'Feature', properties: { id: s.id, index: i, photos: s.photoIds.length }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
  };
}

/** Adds all trail sources and layers. Safe to call again after a style change. */
export function addTrailLayers(map: MlMap) {
  for (const id of ['trail', 'drawn', 'stops', 'head', 'draft']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY, lineMetrics: id === 'drawn' });
  }
  const line = (id: string, source: string, paint: Record<string, unknown>, filter?: ExpressionSpecification) => {
    if (map.getLayer(id)) return;
    map.addLayer({ id, type: 'line', source, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: paint as never, ...(filter ? { filter } : {}) });
  };

  // Full route underneath, faint while the animation is drawing the rest.
  line('trail-ghost', 'trail', { 'line-color': modeColor, 'line-width': 3, 'line-opacity': 0.22 });
  line('trail-selected', 'trail', { 'line-color': '#ffffff', 'line-width': 12, 'line-opacity': 0.35, 'line-blur': 2 }, ['==', ['get', 'id'], '']);
  line('trail-glow', 'drawn', { 'line-color': modeColor, 'line-width': 12, 'line-blur': 8, 'line-opacity': 0.55 });
  line('trail-core', 'drawn', { 'line-color': modeColor, 'line-width': 4 }, ['in', ['get', 'mode'], ['literal', SOLID]]);
  for (const m of DASHED) {
    line(`trail-core-${m}`, 'drawn', { 'line-color': modeColor, 'line-width': 3.5, 'line-dasharray': MODE_META[m].dash }, ['==', ['get', 'mode'], m]);
  }
  line('trail-flow', 'drawn', { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.75, 'line-dasharray': FLOW_STEPS[0] }, ['in', ['get', 'mode'], ['literal', SOLID]]);
  line('draft', 'draft', { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1.5] });
  // Wide invisible line so segments are easy to click.
  line('trail-hit', 'trail', { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 });

  if (!map.getLayer('stops-dot')) {
    map.addLayer({
      id: 'stops-dot',
      type: 'circle',
      source: 'stops',
      paint: { 'circle-radius': 5, 'circle-color': '#0f172a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
  }
  if (!map.getLayer('head-glow')) {
    map.addLayer({
      id: 'head-glow',
      type: 'circle',
      source: 'head',
      paint: { 'circle-radius': 18, 'circle-color': modeColor, 'circle-opacity': 0.35, 'circle-blur': 0.8 },
    });
    map.addLayer({
      id: 'head-dot',
      type: 'circle',
      source: 'head',
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': modeColor, 'circle-stroke-width': 3 },
    });
  }
}

export function setData(map: MlMap, source: string, data: FeatureCollection) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}
