import greatCircle from '@turf/great-circle';
import type { LineString, Position } from 'geojson';
import { db } from '../model/db';
import type { Mode, Routing, Stop } from '../model/types';

type LngLat = [number, number];

const OSRM_PROFILE: Partial<Record<Mode, string>> = { walk: 'foot', bike: 'bike', car: 'car', bus: 'car' };

export const routingSettings = {
  /** `{profile}` is replaced with foot / bike / car. */
  osrmBase: 'https://routing.openstreetmap.de/routed-{profile}',
};

export interface RouteResult {
  geometry: LineString;
  routing: Routing;
}

export const straightLine = (a: LngLat, b: LngLat): LineString => ({ type: 'LineString', coordinates: [a, b] });

/** Great-circle arc; longitudes are unwrapped so arcs across the antimeridian stay one LineString. */
export function arc(a: LngLat, b: LngLat, npoints = 96): LineString {
  const coords = greatCircle(a, b, { npoints }).geometry.coordinates;
  const flat: Position[] = (typeof coords[0][0] === 'number' ? coords : (coords as Position[][]).flat()) as Position[];
  const out: Position[] = [];
  for (const [lng, lat] of flat) {
    const prev = out.at(-1);
    let x = lng;
    if (prev) while (x - prev[0] > 180) x -= 360;
    if (prev) while (prev[0] - x > 180) x += 360;
    out.push([x, lat]);
  }
  return { type: 'LineString', coordinates: out };
}

let queue: Promise<unknown> = Promise.resolve();
const MIN_GAP_MS = 1000;

/** Serialises calls to the public OSRM server to roughly one per second. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, MIN_GAP_MS)));
  return run;
}

async function osrm(profile: string, a: LngLat, b: LngLat): Promise<LngLat[]> {
  const key = `${profile}:${a.map((n) => n.toFixed(5))};${b.map((n) => n.toFixed(5))}`;
  const hit = await db.routeCache.get(key);
  if (hit) return hit.coordinates;
  const url = `${routingSettings.osrmBase.replace('{profile}', profile)}/route/v1/driving/${a.join(',')};${b.join(',')}?overview=full&geometries=geojson`;
  const res = await throttled(() => fetch(url));
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const json = await res.json();
  const coordinates: LngLat[] | undefined = json.routes?.[0]?.geometry?.coordinates;
  if (!coordinates?.length) throw new Error('No route found');
  await db.routeCache.put({ key, coordinates });
  return coordinates;
}

/** Builds a segment's geometry for its mode, falling back to a straight line if routing fails. */
export async function routeBetween(from: Stop, to: Stop, mode: Mode): Promise<RouteResult> {
  const a: LngLat = [from.lng, from.lat];
  const b: LngLat = [to.lng, to.lat];
  if (mode === 'flight') return { geometry: arc(a, b), routing: 'arc' };
  const profile = OSRM_PROFILE[mode];
  if (!profile) return { geometry: straightLine(a, b), routing: 'straight' };
  try {
    const coords = await osrm(profile, a, b);
    return { geometry: { type: 'LineString', coordinates: [a, ...coords, b] }, routing: 'routed' };
  } catch (err) {
    console.warn('Routing fell back to a straight line', err);
    return { geometry: straightLine(a, b), routing: 'straight' };
  }
}
