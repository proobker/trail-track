import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { Journey, Mode } from '../model/types';
import { metres } from '../trail/geo';

type LngLat = [number, number];

interface Track {
  segmentId: string;
  /** Index of the stop this segment leaves from. */
  fromStop: number;
  mode: Mode;
  coords: LngLat[];
  /** Cumulative distance in metres at each coordinate. */
  cum: number[];
  length: number;
  /** Index of the stop this segment arrives at. */
  toStop: number;
}

export type TimelineItem = { kind: 'seg'; track: number; start: number; dur: number } | { kind: 'stop'; stop: number; start: number; dur: number };

export interface Timeline {
  items: TimelineItem[];
  tracks: Track[];
  /** Seconds at speed 1. */
  total: number;
}

export interface Frame {
  drawn: FeatureCollection<LineString>;
  head?: { coord: LngLat; bearing: number; mode: Mode; track: number; /** Eased progress along the current leg. */ frac: number };
  /** Index of the stop the head is pausing at, if any. */
  pauseStop?: number;
  /** Index of the most recently reached stop. */
  reachedStop: number;
}

/** Visual duration of a segment: grows with distance, but logarithmically so flights don't dominate. */
export const segmentSeconds = (lengthM: number) => 1.6 + 1.2 * Math.log10(1 + lengthM / 1000);
export const stopSeconds = (photoCount: number) => (photoCount > 0 ? 2 : 0.35);

export function buildTimeline(j: Journey): Timeline {
  const index = new Map(j.stops.map((s, i) => [s.id, i]));
  const tracks: Track[] = j.segments.map((s) => {
    const coords = s.geometry.coordinates as LngLat[];
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i]));
    return { segmentId: s.id, fromStop: index.get(s.fromStopId) ?? 0, mode: s.mode, coords, cum, length: cum[cum.length - 1], toStop: index.get(s.toStopId) ?? 0 };
  });
  const items: TimelineItem[] = [];
  let t = 0;
  const pushStop = (stop: number) => {
    const dur = stopSeconds(j.stops[stop]?.photoIds.length ?? 0);
    items.push({ kind: 'stop', stop, start: t, dur });
    t += dur;
  };
  if (j.stops.length) pushStop(0);
  tracks.forEach((tr, i) => {
    const dur = segmentSeconds(tr.length);
    items.push({ kind: 'seg', track: i, start: t, dur });
    t += dur;
    pushStop(tr.toStop);
  });
  return { items, tracks, total: t };
}

/** Coordinates of a track from its start up to `frac` of its length, with an interpolated end point. */
export function sliceTrack(tr: Track, frac: number): LngLat[] {
  if (frac >= 1) return tr.coords;
  const target = tr.length * Math.max(0, frac);
  let i = 1;
  while (i < tr.cum.length - 1 && tr.cum[i] < target) i++;
  const span = tr.cum[i] - tr.cum[i - 1] || 1;
  const f = (target - tr.cum[i - 1]) / span;
  const a = tr.coords[i - 1];
  const b = tr.coords[i];
  return [...tr.coords.slice(0, i), [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]];
}

/** Clock time at the head: interpolated between the leg's two stop times when both are known. */
export function frameTime(j: Journey, tl: Timeline, f: Frame): number | undefined {
  if (!f.head) return j.stops[f.pauseStop ?? f.reachedStop]?.arrivedAt;
  const tr = tl.tracks[f.head.track];
  const a = j.stops[tr.fromStop]?.arrivedAt;
  const b = j.stops[tr.toStop]?.arrivedAt;
  if (a == null) return b;
  if (b == null || b < a) return a;
  return a + (b - a) * f.head.frac;
}

function bearing(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const lineFeature = (tr: Track, coords: LngLat[]): Feature<LineString> => ({
  type: 'Feature',
  properties: { mode: tr.mode, id: tr.segmentId },
  geometry: { type: 'LineString', coordinates: coords },
});

/** Samples the timeline at `progress` (0–1). */
export function sample(tl: Timeline, progress: number): Frame {
  const t = Math.min(1, Math.max(0, progress)) * tl.total;
  const features: Feature<LineString>[] = [];
  let head: Frame['head'];
  let pauseStop: number | undefined;
  let reachedStop = 0;
  for (const it of tl.items) {
    if (it.start > t) break;
    const frac = it.dur ? (t - it.start) / it.dur : 1;
    if (it.kind === 'stop') {
      reachedStop = it.stop;
      if (frac < 1) pauseStop = it.stop;
      continue;
    }
    const tr = tl.tracks[it.track];
    if (frac >= 1) {
      features.push(lineFeature(tr, tr.coords));
      continue;
    }
    // Ease in and out of each segment.
    const eased = frac < 0.5 ? 2 * frac * frac : 1 - (-2 * frac + 2) ** 2 / 2;
    const coords = sliceTrack(tr, eased);
    if (coords.length >= 2) features.push(lineFeature(tr, coords));
    const end = coords[coords.length - 1];
    const back = sliceTrack(tr, Math.max(0, eased - 0.02));
    head = { coord: end, bearing: bearing(back[back.length - 1], end), mode: tr.mode, track: it.track, frac: eased };
  }
  return { drawn: { type: 'FeatureCollection', features }, head, pauseStop, reachedStop };
}
