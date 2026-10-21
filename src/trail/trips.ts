import { uid, type Journey } from '../model/types';
import { localDay } from './days';

export const DAY_MS = 86_400_000;
/** Photos at least this many days apart are treated as separate trips unless the user says otherwise. */
export const TRIP_GAP_DAYS = 3;

/** Default journey name for a date range, e.g. "12 May 2024" or "2024-05-12 → 2024-05-19". */
export const rangeTitle = (from: string, to: string) =>
  from === to ? new Date(`${from}T12:00`).toLocaleDateString(undefined, { dateStyle: 'long' }) : `${from} → ${to}`;

/** Sorts items by time and starts a new trip wherever consecutive items are at least `gapMs` apart. */
export function splitIntoTrips<T>(items: T[], timeOf: (x: T) => number, gapMs: number): T[][] {
  const trips: T[][] = [];
  for (const x of [...items].sort((a, b) => timeOf(a) - timeOf(b))) {
    const cur = trips.at(-1);
    if (cur && timeOf(x) - timeOf(cur.at(-1)!) < gapMs) cur.push(x);
    else trips.push([x]);
  }
  return trips;
}

/** Stops that come at least `gapMs` after the previous timed stop, i.e. where a new trip begins. */
export function tripStarts(j: Journey, gapMs: number): { index: number; gapMs: number }[] {
  const out: { index: number; gapMs: number }[] = [];
  let last: number | undefined;
  j.stops.forEach((s, index) => {
    if (s.arrivedAt == null) return;
    if (last != null && s.arrivedAt - last >= gapMs) out.push({ index, gapMs: s.arrivedAt - last });
    last = s.arrivedAt;
  });
  return out;
}

/**
 * Cuts a journey before each stop index in `cuts`. The first part keeps the journey's id; legs that
 * crossed a cut are dropped. Loose photos go to the part whose time span they fall in. Auto-named
 * journeys get fresh date-range names; others become "Title (2)", "Title (3)", …
 */
export function splitJourney(j: Journey, cuts: number[], takenAt: (photoId: string) => number | undefined): Journey[] {
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
    const title = autoNamed && dateFrom && dateTo ? rangeTitle(dateFrom, dateTo) : k === 0 ? j.title : `${j.title} (${k + 1})`;
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
