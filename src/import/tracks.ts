import { gpx, kml } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, Geometry, LineString } from 'geojson';
import { uid, type Mode, type Segment, type Stop } from '../model/types';
import { inferMode } from '../trail/inferMode';
import { metres } from '../trail/geo';

export interface ImportedTrack {
  title: string;
  stops: Stop[];
  segments: Segment[];
}

type LngLat = [number, number];
const MAX_POINTS = 4000;

const MODE_WORDS: [RegExp, Mode][] = [
  [/walk|hik|foot|run/i, 'walk'],
  [/bik|cycl/i, 'bike'],
  [/\bcar\b|driv/i, 'car'],
  [/\bbus\b/i, 'bus'],
  [/train|rail|subway|metro|tram/i, 'train'],
  [/boat|ferry|ship/i, 'boat'],
  [/\bfl(y|ight)|plane/i, 'flight'],
];

const modeFromProps = (p: Record<string, unknown> | null): Mode | undefined => {
  const text = [p?.type, p?.activity].filter((x) => typeof x === 'string').join(' ');
  return MODE_WORDS.find(([re]) => re.test(text))?.[1];
};

function downsample(coords: LngLat[]): LngLat[] {
  if (coords.length <= MAX_POINTS) return coords;
  const step = coords.length / MAX_POINTS;
  const out: LngLat[] = [];
  for (let i = 0; i < MAX_POINTS - 1; i++) out.push(coords[Math.floor(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

function lines(f: Feature): { coords: LngLat[]; times?: string[] }[] {
  const g = f.geometry as Geometry | null;
  const cp = (f.properties?.coordinateProperties ?? {}) as { times?: unknown; coordTimes?: unknown };
  const t = (cp.times ?? cp.coordTimes) as string[] | string[][] | undefined;
  const strip = (c: number[][]) => c.map((p) => [p[0], p[1]] as LngLat);
  if (g?.type === 'LineString') return [{ coords: strip(g.coordinates), times: t as string[] | undefined }];
  if (g?.type === 'MultiLineString') return g.coordinates.map((c, i) => ({ coords: strip(c), times: (t as string[][] | undefined)?.[i] }));
  return [];
}

export function parseTrackText(text: string, fileName: string): FeatureCollection {
  if (/\.(geo)?json$/i.test(fileName)) {
    const json = JSON.parse(text);
    if (json.type === 'FeatureCollection') return json;
    return { type: 'FeatureCollection', features: [json.type === 'Feature' ? json : { type: 'Feature', properties: {}, geometry: json }] };
  }
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${fileName} is not valid XML`);
  return (/\.gpx$/i.test(fileName) ? gpx(doc) : kml(doc)) as FeatureCollection;
}

/** Converts tracks to stops at each track's ends plus one imported segment per track. Points become stops when there are no tracks. */
export function trackToJourney(fc: FeatureCollection, title: string): ImportedTrack {
  const stops: Stop[] = [];
  const segments: Segment[] = [];
  const parseT = (s?: unknown) => (typeof s === 'string' ? Date.parse(s) || undefined : undefined);
  const stopAt = (c: LngLat, at?: number, label?: string): Stop => {
    const last = stops.at(-1);
    if (last && metres([last.lng, last.lat], c) < 30) return last;
    const s: Stop = { id: uid(), lng: c[0], lat: c[1], arrivedAt: at, label, photoIds: [], origin: 'import' };
    stops.push(s);
    return s;
  };

  for (const f of fc.features) {
    for (const { coords, times } of lines(f)) {
      if (coords.length < 2) continue;
      const a = stopAt(coords[0], parseT(times?.[0]));
      const end = coords[coords.length - 1];
      const b: Stop = { id: uid(), lng: end[0], lat: end[1], arrivedAt: parseT(times?.at(-1)), photoIds: [], origin: 'import' };
      stops.push(b);
      const geometry: LineString = { type: 'LineString', coordinates: downsample(coords) };
      segments.push({ id: uid(), fromStopId: a.id, toStopId: b.id, mode: modeFromProps(f.properties) ?? inferMode(a, b), geometry, routing: 'imported' });
    }
  }

  const points = fc.features.filter((f) => f.geometry?.type === 'Point');
  if (segments.length === 0) {
    for (const f of points) {
      const [lng, lat] = (f.geometry as { coordinates: number[] }).coordinates;
      stopAt([lng, lat], parseT(f.properties?.time), f.properties?.name as string | undefined);
    }
  } else {
    // Name track endpoints after nearby waypoints.
    for (const f of points) {
      if (!f.properties?.name) continue;
      const p = (f.geometry as { coordinates: number[] }).coordinates as LngLat;
      const near = stops.find((s) => !s.label && metres([s.lng, s.lat], p) < 200);
      if (near) near.label = String(f.properties.name);
    }
  }
  return { title, stops, segments };
}
