import type { Journey } from '../model/types';
import { db } from '../model/db';

type Coord = [number, number];
type Bounds = [south: number, west: number, north: number, east: number];

interface OsmPoint { lat: number; lon: number }
interface OsmElement {
  type: 'way' | 'relation';
  id: number;
  tags?: { name?: string; ref?: string; route?: string; access?: string; foot?: string; sac_scale?: string; trail_visibility?: string };
  geometry?: OsmPoint[];
  members?: { type: string; geometry?: OsmPoint[] }[];
}

export interface TrailCandidate {
  source: 'osm' | 'usgs';
  type: 'relation' | 'way' | 'feature';
  id: number;
  name: string;
  ref?: string;
  lines: Coord[][];
  nearStops: number;
  totalStops: number;
  averageDistanceM: number;
  difficulty?: string;
  visibility?: string;
}

const MAX_SPAN_M = 30_000;
const MAX_AREA_M2 = 500_000_000;
const SEARCH_PAD_M = 500;
const NEAR_M = 300;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

/** Search only a compact walking outing, or the selected walking leg. */
export function trailSearchArea(j: Journey, segmentId?: string): { bounds: Bounds; stops: Coord[] } {
  const selected = j.segments.find((s) => s.id === segmentId && s.mode === 'walk');
  const walking = selected ? [selected] : j.segments.filter((s) => s.mode === 'walk');
  const ids = new Set(walking.flatMap((s) => [s.fromStopId, s.toStopId]));
  const stops = j.stops.filter((s) => ids.has(s.id)).map((s) => [s.lng, s.lat] as Coord);
  if (stops.length < 2) throw new Error('Add two walking stops before looking for trails.');
  const route = walking.flatMap((s) => s.geometry.coordinates.filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]] as Coord));
  const all = [...stops, ...route];
  const west = Math.min(...all.map((p) => p[0]));
  const east = Math.max(...all.map((p) => p[0]));
  const south = Math.min(...all.map((p) => p[1]));
  const north = Math.max(...all.map((p) => p[1]));
  const lat = (south + north) / 2;
  const mPerLng = 111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const width = (east - west) * mPerLng;
  const height = (north - south) * 111_320;
  if (width > MAX_SPAN_M || height > MAX_SPAN_M || width * height > MAX_AREA_M2) {
    throw new Error('This walking journey covers a large area. Select one walking leg, then search again.');
  }
  const padLng = SEARCH_PAD_M / mPerLng;
  const padLat = SEARCH_PAD_M / 111_320;
  // Sparse stops get extra evidence from the route geometry, capped so a long GPX cannot dominate ranking.
  const stride = Math.max(1, Math.ceil(route.length / 20));
  return { bounds: [Math.max(-90, south - padLat), Math.max(-180, west - padLng), Math.min(90, north + padLat), Math.min(180, east + padLng)], stops: [...stops, ...route.filter((_, i) => i % stride === 0).slice(0, 20)] };
}

const validPoint = (p: OsmPoint) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function linesOf(el: OsmElement): Coord[][] {
  const geometries = el.type === 'way' ? [el.geometry] : el.members?.filter((m) => m.type === 'way').map((m) => m.geometry) ?? [];
  let remaining = 6000;
  const lines: Coord[][] = [];
  for (const geometry of geometries) {
    if (!geometry || remaining < 2) break;
    const coords = geometry.filter(validPoint).slice(0, remaining).map((p) => [p.lon, p.lat] as Coord);
    if (coords.length >= 2) {
      lines.push(coords);
      remaining -= coords.length;
    }
  }
  return lines;
}

function pointLineDistanceM(point: Coord, lines: Coord[][]): number {
  const scale = Math.cos((point[1] * Math.PI) / 180);
  const xy = (p: Coord): Coord => [(p[0] - point[0]) * 111_320 * scale, (p[1] - point[1]) * 111_320];
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = xy(line[i - 1]);
      const b = xy(line[i]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
  }
  return best;
}

/** Converts bounded Overpass results into nearby named candidates. No route is automatically changed. */
export function parseTrailCandidates(elements: OsmElement[], stops: Coord[]): TrailCandidate[] {
  const seen = new Set<string>();
  const out: TrailCandidate[] = [];
  for (const el of elements) {
    if ((el.type !== 'relation' && el.type !== 'way') || !Number.isSafeInteger(el.id)) continue;
    if (el.tags?.foot === 'no' || el.tags?.foot === 'private' || (el.tags?.access === 'private' && el.tags?.foot !== 'yes' && el.tags?.foot !== 'designated')) continue;
    const name = el.tags?.name?.trim() || el.tags?.ref?.trim();
    if (!name) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lines = linesOf(el);
    if (!lines.length) continue;
    const distances = stops.map((p) => pointLineDistanceM(p, lines));
    const nearStops = distances.filter((d) => d <= NEAR_M).length;
    if (!nearStops) continue;
    out.push({ source: 'osm', type: el.type, id: el.id, name, ref: el.tags?.ref, lines, nearStops, totalStops: stops.length, averageDistanceM: distances.reduce((a, b) => a + b, 0) / stops.length, difficulty: el.tags?.sac_scale, visibility: el.tags?.trail_visibility });
  }
  return out.sort((a, b) => b.nearStops - a.nearStops || a.averageDistanceM - b.averageDistanceM || (a.type === 'relation' ? -1 : 1)).slice(0, 12);
}

interface UsgsFeature {
  type?: string;
  id?: number;
  properties?: { objectid?: number; name?: string; trailnumber?: string; hikerpedestrian?: string; trailtype?: string };
  geometry?: { type?: string; coordinates?: unknown };
}

/** USGS National Map trails supplement OSM within the United States. */
export function parseUsgsCandidates(features: UsgsFeature[], points: Coord[]): TrailCandidate[] {
  const out: TrailCandidate[] = [];
  for (const f of features) {
    const id = f.properties?.objectid ?? f.id;
    const name = f.properties?.name?.trim();
    if (!Number.isSafeInteger(id) || !name || !f.geometry) continue;
    if (f.properties?.hikerpedestrian === 'N' || (f.properties?.trailtype && f.properties.trailtype !== 'Terra Trail')) continue;
    const raw = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : undefined;
    if (!Array.isArray(raw)) continue;
    let remaining = 6000;
    const lines: Coord[][] = [];
    for (const line of raw) {
      if (!Array.isArray(line) || remaining < 2) break;
      const coords = line.filter((p): p is Coord => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, remaining);
      if (coords.length >= 2) {
        lines.push(coords);
        remaining -= coords.length;
      }
    }
    if (!lines.length) continue;
    const distances = points.map((p) => pointLineDistanceM(p, lines));
    const nearStops = distances.filter((d) => d <= NEAR_M).length;
    if (nearStops) out.push({ source: 'usgs', type: 'feature', id: id!, name, ref: f.properties?.trailnumber, lines, nearStops, totalStops: points.length, averageDistanceM: distances.reduce((a, b) => a + b, 0) / points.length });
  }
  return out.sort((a, b) => b.nearStops - a.nearStops || a.averageDistanceM - b.averageDistanceM).slice(0, 12);
}

function inUnitedStates([south, west, north, east]: Bounds) {
  return south >= 18 && north <= 72 && west >= -180 && east <= -65;
}

async function fetchUsgs(bounds: Bounds, signal?: AbortSignal): Promise<UsgsFeature[]> {
  const [south, west, north, east] = bounds;
  const params = new URLSearchParams({
    f: 'geojson', where: 'name IS NOT NULL', geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'objectid,name,trailnumber,hikerpedestrian,trailtype',
    returnGeometry: 'true', resultRecordCount: '200', geometryPrecision: '6', maxAllowableOffset: '0.00002',
  });
  const response = await fetch(`https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37/query?${params}`, { signal });
  if (!response.ok) throw new Error(`USGS search failed (${response.status})`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !Array.isArray((data as { features?: unknown }).features)) throw new Error('Unexpected USGS response');
  return (data as { features: UsgsFeature[] }).features;
}

export async function findNearbyTrails(j: Journey, segmentId?: string, signal?: AbortSignal): Promise<TrailCandidate[]> {
  const { bounds, stops } = trailSearchArea(j, segmentId);
  const bbox = bounds.map((n) => n.toFixed(6)).join(',');
  const key = `v1:${bbox}`;
  let cached;
  try { cached = await db.trailCache.get(key); } catch { /* IndexedDB may be unavailable in private browsing. */ }
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    let usgsFeatures = cached.usgsFeatures as UsgsFeature[] | undefined;
    if (inUnitedStates(bounds) && !usgsFeatures) {
      try {
        usgsFeatures = await fetchUsgs(bounds, signal);
        await db.trailCache.put({ ...cached, usgsFeatures });
      } catch (error) { if (signal?.aborted) throw error; }
    }
    return [...parseTrailCandidates(cached.elements as OsmElement[], stops), ...parseUsgsCandidates(usgsFeatures ?? [], stops)]
      .sort((a, b) => b.nearStops - a.nearStops || a.averageDistanceM - b.averageDistanceM).slice(0, 12);
  }
  // The search is user initiated and bounded; the public service is not queried while the map moves.
  const query = `[out:json][timeout:20][maxsize:20971520];(relation["type"="route"]["route"~"^(hiking|foot)$"](${bbox});way["highway"~"^(path|footway|track|steps)$"]["name"](${bbox}););out geom(${bbox});`;
  const osmRequest = async (): Promise<OsmElement[]> => {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }), signal });
    if (!res.ok) throw new Error(`OpenStreetMap trail search failed (${res.status}). Please try again.`);
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as { elements?: unknown }).elements)) throw new Error('Trail search returned an unexpected response.');
    return (data as { elements: OsmElement[] }).elements;
  };
  const [osm, usgs] = await Promise.allSettled([osmRequest(), inUnitedStates(bounds) ? fetchUsgs(bounds, signal) : Promise.resolve([])]);
  if (signal?.aborted) throw new Error('Trail search timed out. Please try again.');
  if (osm.status === 'rejected' && (usgs.status === 'rejected' || usgs.value.length === 0)) throw osm.reason;
  const elements = osm.status === 'fulfilled' ? osm.value : [];
  const usgsFeatures = usgs.status === 'fulfilled' ? usgs.value : undefined;
  if (osm.status === 'fulfilled') {
    try { await db.trailCache.put({ key, fetchedAt: Date.now(), elements, usgsFeatures }); } catch { /* Use results without cache. */ }
  }
  return [...parseTrailCandidates(elements, stops), ...parseUsgsCandidates(usgsFeatures ?? [], stops)]
    .sort((a, b) => b.nearStops - a.nearStops || a.averageDistanceM - b.averageDistanceM).slice(0, 12);
}
