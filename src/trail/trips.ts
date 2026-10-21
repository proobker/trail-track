import { uid, type Journey } from '../model/types';
import { localDay } from './days';
import { metres } from './geo';

export const DAY_MS = 86_400_000;
/** Away from home, photos at least this many days apart are treated as separate trips. */
export const TRIP_GAP_DAYS = 3;
/** Photos within this distance of home count as "at home". */
export const HOME_RADIUS_M = 50_000;

/** ~25 km grid used to find home. */
const CELL_DEG = 0.25;
/** A home needs to show up on at least this many days... */
const MIN_HOME_DAYS = 8;
/** ...and on this share of all photographed days... */
const MIN_HOME_SHARE = 0.3;
/** ...in a library spanning at least this long. A single trip, however long, has no home. */
const MIN_SPAN_DAYS = 45;
/** A stop back home shorter than this, between two trips, is a layover: the trips are one. */
const LAYOVER_MS = 12 * 3_600_000;

/** Default journey name for a date range, e.g. "12 May 2024" or "2024-05-12 → 2024-05-19". */
export const rangeTitle = (from: string, to: string) =>
  from === to ? new Date(`${from}T12:00`).toLocaleDateString(undefined, { dateStyle: 'long' }) : `${from} → ${to}`;

export interface TripPoint {
  t: number;
  lat?: number;
  lng?: number;
}

export interface Home {
  lat: number;
  lng: number;
  /** Distinct days photographed there. */
  days: number;
}

export interface TripGroup<T> {
  items: T[];
  /** An at-home stretch between trips rather than a trip. */
  home: boolean;
  /** Why this group starts a new journey (undefined for the first). */
  reason?: 'left' | 'back' | 'gap';
}

/**
 * Home is the area photographed on the most distinct days, the same signal photo apps use to tell
 * trips from everyday life. Days are counted over a 3×3 block of grid cells so a city on a cell
 * edge isn't split in two. Returns undefined when no place stands out (e.g. the photos are one trip).
 */
export function findHome(points: TripPoint[]): Home | undefined {
  const located = points.filter((p): p is Required<TripPoint> => p.lat != null && p.lng != null);
  if (located.length < 2) return undefined;
  // A reduce rather than Math.max(...): a whole library can be more points than the call stack takes.
  const [lo, hi] = located.reduce(([a, b], p) => [Math.min(a, p.t), Math.max(b, p.t)], [Infinity, -Infinity]);
  if (hi - lo < MIN_SPAN_DAYS * DAY_MS) return undefined;

  type Acc = { days: Set<string>; lat: number; lng: number; n: number };
  const cells = new Map<string, Acc>();
  const allDays = new Set<string>();
  for (const p of located) {
    const day = localDay(p.t);
    allDays.add(day);
    const key = `${Math.round(p.lat / CELL_DEG)},${Math.round(p.lng / CELL_DEG)}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { days: new Set(), lat: 0, lng: 0, n: 0 }));
    c.days.add(day);
    c.lat += p.lat;
    c.lng += p.lng;
    c.n++;
  }
  let best: Acc | undefined;
  for (const key of cells.keys()) {
    const [y, x] = key.split(',').map(Number);
    const block: Acc = { days: new Set(), lat: 0, lng: 0, n: 0 };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = cells.get(`${y + dy},${x + dx}`);
        if (!c) continue;
        for (const d of c.days) block.days.add(d);
        block.lat += c.lat;
        block.lng += c.lng;
        block.n += c.n;
      }
    }
    if (!best || block.days.size > best.days.size) best = block;
  }
  if (!best || best.days.size < MIN_HOME_DAYS || best.days.size < allDays.size * MIN_HOME_SHARE) return undefined;
  return { lat: best.lat / best.n, lng: best.lng / best.n, days: best.days.size };
}

/**
 * Splits items into trips. With a home, a trip is a stretch of photos away from home (beyond
 * HOME_RADIUS_M); the stretches at home in between come back as `home` groups. Away from home, or
 * without a home, a gap of `gapMs` with no photos also starts a new trip. Photos without a location
 * count as wherever the photo closest in time was taken.
 */
export function groupTrips<T>(items: T[], at: (x: T) => TripPoint, gapMs: number, home?: Home): TripGroup<T>[] {
  const sorted = [...items].sort((a, b) => at(a).t - at(b).t);
  const pts = sorted.map(at);
  const known = pts.map((p) => (!home ? true : p.lat != null && p.lng != null ? metres([home.lng, home.lat], [p.lng, p.lat]) > HOME_RADIUS_M : undefined));
  const away = known.map((k, i) => {
    if (k !== undefined) return k;
    let before = i - 1;
    while (before >= 0 && known[before] === undefined) before--;
    let after = i + 1;
    while (after < known.length && known[after] === undefined) after++;
    const db = before >= 0 ? pts[i].t - pts[before].t : Infinity;
    const da = after < known.length ? pts[after].t - pts[i].t : Infinity;
    return db === Infinity && da === Infinity ? true : db <= da ? known[before]! : known[after]!;
  });

  let groups: TripGroup<T>[] = [];
  sorted.forEach((x, i) => {
    const cur = groups.at(-1);
    const isHome = !away[i];
    if (!cur) return groups.push({ items: [x], home: isHome });
    if (cur.home !== isHome) return groups.push({ items: [x], home: isHome, reason: isHome ? 'back' : 'left' });
    if (!isHome && pts[i].t - pts[i - 1].t >= gapMs) return groups.push({ items: [x], home: false, reason: 'gap' });
    cur.items.push(x);
  });

  // A short spell at home between two trips (changing planes, one night) joins them into one trip.
  const span = (g: TripGroup<T>) => at(g.items.at(-1)!).t - at(g.items[0]).t;
  for (let i = 1; i < groups.length - 1; i++) {
    const [prev, g, next] = [groups[i - 1], groups[i], groups[i + 1]];
    if (g.home && !prev.home && !next.home && span(g) < LAYOVER_MS && at(next.items[0]).t - at(prev.items.at(-1)!).t < gapMs) {
      groups = [...groups.slice(0, i - 1), { ...prev, items: [...prev.items, ...g.items, ...next.items] }, ...groups.slice(i + 2)];
      i--;
    }
  }
  return groups;
}

/** Where the active journey should be cut into trips: the first stop of every group after the first. */
export function journeyTrips(j: Journey, gapMs: number = TRIP_GAP_DAYS * DAY_MS) {
  // Stops without a time ride along with the stop before them.
  let lastT = j.stops.find((s) => s.arrivedAt != null)?.arrivedAt ?? 0;
  const items = j.stops.map((s, index) => ({ index, t: (lastT = s.arrivedAt ?? lastT), lat: s.lat, lng: s.lng }));
  const home = findHome(items);
  const groups = groupTrips(items, (x) => x, gapMs, home);
  // groupTrips sorts by time; only offer cuts when that keeps the journey's own order.
  const inOrder = groups.flatMap((g) => g.items.map((x) => x.index)).every((v, i) => v === i);
  if (!inOrder || groups.length < 2) return { home, cuts: [], homeParts: [] };
  return {
    home,
    cuts: groups.slice(1).map((g) => ({ index: g.items[0].index, reason: g.reason!, gapMs: g.items[0].t - items[g.items[0].index - 1].t })),
    homeParts: groups.map((g) => g.home),
  };
}

/**
 * Cuts a journey before each stop index in `cuts`. The first part keeps the journey's id; legs that
 * crossed a cut are dropped. Loose photos go to the part whose time span they fall in. Auto-named
 * journeys get fresh date-range names; others become "Title (2)", "Title (3)", … Parts flagged in
 * `homeParts` are named "At home · …".
 */
export function splitJourney(j: Journey, cuts: number[], takenAt: (photoId: string) => number | undefined, homeParts: boolean[] = []): Journey[] {
  const bounds = [0, ...cuts, j.stops.length];
  const parts = bounds.slice(1).map((end, k) => j.stops.slice(bounds[k], end));
  const starts = parts.map((stops) => stops.find((s) => s.arrivedAt != null)?.arrivedAt ?? Infinity);
  const partOf = (t = -Infinity) => starts.reduce((at, start, k) => (t >= start ? k : at), 0);
  const autoNamed = !!j.dateFrom && !!j.dateTo && j.title === rangeTitle(j.dateFrom, j.dateTo);

  return parts.map((stops, k) => {
    const ids = new Set(stops.map((s) => s.id));
    const times = stops.map((s) => s.arrivedAt).filter((t): t is number => t != null);
    const dateFrom = times.length ? localDay(Math.min(...times)) : undefined;
    const dateTo = times.length ? localDay(Math.max(...times)) : undefined;
    const dated = dateFrom && dateTo ? rangeTitle(dateFrom, dateTo) : undefined;
    const title = homeParts[k] && dated ? `At home · ${dated}` : autoNamed && dated ? dated : k === 0 ? j.title : `${j.title} (${k + 1})`;
    return {
      ...j,
      id: k === 0 ? j.id : uid(),
      title,
      dateFrom,
      dateTo,
      stops,
      segments: j.segments.filter((s) => ids.has(s.fromStopId) && ids.has(s.toStopId)),
      loosePhotoIds: (j.loosePhotoIds ?? []).filter((id) => partOf(takenAt(id)) === k),
      updatedAt: Date.now(),
    };
  });
}
