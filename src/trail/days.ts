import type { Journey, Mode, Stop } from '../model/types';
import { lineMetres } from './geo';

export interface DayGroup {
  /** Local YYYY-MM-DD, or undefined for stops without a time. */
  date?: string;
  /** 1-based day number within the journey; undefined for the undated group. */
  dayNumber?: number;
  stops: { stop: Stop; index: number }[];
  /** Distance of the legs that start on this day. */
  metres: number;
  modes: Mode[];
  photoCount: number;
  /** Time between the first and last stop of the day. */
  spanMs: number;
}

export const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Groups stops into consecutive days. Stops without a time join the day of the stop
 * before them, or a leading "undated" group when nothing before them has a time.
 */
export function groupByDay(j: Journey): DayGroup[] {
  const groups: DayGroup[] = [];
  const segFrom = new Map(j.segments.map((s) => [s.fromStopId, s]));
  let first: number | undefined;
  for (let i = 0; i < j.stops.length; i++) {
    const stop = j.stops[i];
    const date = stop.arrivedAt != null ? localDay(stop.arrivedAt) : groups.at(-1)?.date;
    let g = groups.at(-1);
    if (!g || g.date !== date) {
      g = { date, stops: [], metres: 0, modes: [], photoCount: 0, spanMs: 0 };
      groups.push(g);
    }
    g.stops.push({ stop, index: i });
    g.photoCount += stop.photoIds.length;
    const seg = segFrom.get(stop.id);
    if (seg && i < j.stops.length - 1) {
      g.metres += lineMetres(seg.geometry.coordinates as [number, number][]);
      if (!g.modes.includes(seg.mode)) g.modes.push(seg.mode);
    }
  }
  for (const g of groups) {
    if (!g.date) continue;
    const t = Date.parse(`${g.date}T12:00:00`);
    first ??= t;
    g.dayNumber = Math.round((t - first) / 86_400_000) + 1;
    const times = g.stops.map((s) => s.stop.arrivedAt).filter((x): x is number => x != null);
    g.spanMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
  }
  return groups;
}
