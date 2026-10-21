/* eslint-disable @typescript-eslint/no-explicit-any -- Timeline exports are loosely shaped JSON. */
import type { Photo } from '../model/types';

/** A located moment from Google Timeline. Visits (`end` set) cover a stay; the rest are instants. */
export interface Fix {
  t: number;
  end?: number;
  lat: number;
  lng: number;
  /** Source-reported horizontal accuracy, when the export contains it. */
  accuracyM?: number;
  /** Local UTC offset in minutes, where the export says. */
  off?: number;
}

export interface Located {
  lat: number;
  lng: number;
  via: 'visit' | 'path';
  method: 'visit' | 'interpolated' | 'nearest';
  accuracyM?: number;
  timeGapMs?: number;
}

const MIN = 60_000;
/** A lone path point counts if it is this close in time to the photo. */
const NEAREST_MS = 45 * MIN;
/** Between two path points this close together, the position is interpolated. */
const INTERPOLATE_MS = 3 * 60 * MIN;
/** Raw fixes vaguer than this are skipped. */
const MAX_ACCURACY_M = 1000;

/** "48.1351°, 11.582°" (Android) or "geo:48.1351,11.582" (iPhone). */
export function parseLatLng(v: unknown): [number, number] | undefined {
  if (typeof v !== 'string') return undefined;
  const [lat, lng, extra] = v.replace(/^geo:/, '').split(',').map((s) => parseFloat(s));
  if (extra !== undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return undefined;
  return [lat, lng];
}

const e7 = (o: any): [number, number] | undefined => {
  const lat = o?.latitudeE7 ?? o?.latE7;
  const lng = o?.longitudeE7 ?? o?.lngE7;
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? [lat / 1e7, lng / 1e7] : undefined;
};

const time = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
};

/** "+05:45" at the end of an ISO time, in minutes. "Z" says nothing about local time. */
const isoOffset = (v: unknown): number | undefined => {
  const m = typeof v === 'string' ? v.match(/T.*([+-])(\d{2}):?(\d{2})$/) : null;
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : undefined;
};

/** One entry of `semanticSegments` (Android) or of the top-level array (iPhone). */
function fromSegment(s: any, out: Fix[]) {
  const start = time(s?.startTime);
  if (start == null) return;
  const end = time(s.endTime) ?? start;
  const off = s.startTimeTimezoneUtcOffsetMinutes ?? isoOffset(s.startTime);
  const endOff = s.endTimeTimezoneUtcOffsetMinutes ?? isoOffset(s.endTime) ?? off;
  const place = s.visit?.topCandidate?.placeLocation;
  const v = parseLatLng(place?.latLng ?? place);
  if (v) out.push({ t: start, end, lat: v[0], lng: v[1], off });
  if (s.activity) {
    const a = parseLatLng(s.activity.start?.latLng ?? s.activity.start);
    const b = parseLatLng(s.activity.end?.latLng ?? s.activity.end);
    if (a) out.push({ t: start, lat: a[0], lng: a[1], off });
    if (b) out.push({ t: end, lat: b[0], lng: b[1], off: endOff });
  }
  for (const p of s.timelinePath ?? []) {
    const ll = parseLatLng(p?.point);
    const t = p?.time != null ? time(p.time) : p?.durationMinutesOffsetFromStartTime != null ? start + Number(p.durationMinutesOffsetFromStartTime) * MIN : undefined;
    if (ll && t != null) out.push({ t, lat: ll[0], lng: ll[1], off: isoOffset(p.time) ?? off });
  }
}

/** Older Takeout "Semantic Location History" monthly files. */
function fromTimelineObject(o: any, out: Fix[]) {
  const pv = o?.placeVisit;
  if (pv) {
    const ll = e7(pv.location);
    const start = time(pv.duration?.startTimestamp ?? pv.duration?.startTimestampMs);
    const end = time(pv.duration?.endTimestamp ?? pv.duration?.endTimestampMs);
    if (ll && start != null) out.push({ t: start, end: end ?? start, lat: ll[0], lng: ll[1] });
  }
  const as = o?.activitySegment;
  if (as) {
    const start = time(as.duration?.startTimestamp ?? as.duration?.startTimestampMs);
    const end = time(as.duration?.endTimestamp ?? as.duration?.endTimestampMs);
    const a = e7(as.startLocation);
    const b = e7(as.endLocation);
    if (a && start != null) out.push({ t: start, lat: a[0], lng: a[1] });
    if (b && end != null) out.push({ t: end, lat: b[0], lng: b[1] });
    for (const p of as.simplifiedRawPath?.points ?? []) {
      const ll = e7(p);
      const t = time(p.timestamp ?? p.timestampMs);
      if (ll && t != null) out.push({ t, lat: ll[0], lng: ll[1] });
    }
  }
}

/** Reads any Google Timeline export: the phone export (Android or iPhone) or Takeout's Records.json / Semantic Location History. */
export function parseTimeline(json: unknown): Fix[] {
  const out: Fix[] = [];
  const j = json as any;
  if (Array.isArray(j)) for (const s of j) fromSegment(s, out);
  for (const s of j?.semanticSegments ?? []) fromSegment(s, out);
  for (const r of j?.rawSignals ?? []) {
    const pos = r?.position;
    const ll = parseLatLng(pos?.LatLng ?? pos?.latLng);
    const t = time(pos?.timestamp);
    if (ll && t != null && !(pos.accuracyMeters > MAX_ACCURACY_M)) out.push({ t, lat: ll[0], lng: ll[1], accuracyM: Number.isFinite(pos.accuracyMeters) && pos.accuracyMeters >= 0 ? pos.accuracyMeters : undefined, off: isoOffset(pos.timestamp) });
  }
  for (const o of j?.timelineObjects ?? []) fromTimelineObject(o, out);
  for (const l of j?.locations ?? []) {
    const ll = e7(l);
    const t = time(l?.timestamp ?? l?.timestampMs);
    if (ll && t != null && !(l.accuracy > MAX_ACCURACY_M)) out.push({ t, lat: ll[0], lng: ll[1], accuracyM: Number.isFinite(l.accuracy) && l.accuracy >= 0 ? l.accuracy : undefined });
  }
  return out;
}

/** Sorts fixes and lends each one without a known UTC offset the offset of its nearest neighbour that has one. */
export function prepareFixes(fixes: Fix[]): Fix[] {
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  let last: number | undefined;
  const filled = sorted.map((f) => (f.off != null ? ((last = f.off), f) : { ...f, off: last }));
  last = undefined;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (sorted[i].off != null) last = sorted[i].off;
    else if (filled[i].off == null && last != null) filled[i] = { ...filled[i], off: last };
  }
  return filled;
}

export async function readTimelineFiles(files: File[]): Promise<Fix[]> {
  const all: Fix[] = [];
  for (const f of files) {
    try {
      all.push(...parseTimeline(JSON.parse(await f.text())));
    } catch {
      throw new Error(`Couldn't read ${f.name}. Is it a Timeline export (.json)?`);
    }
  }
  if (!all.length) throw new Error("No locations found. That doesn't look like Google Timeline data.");
  return prepareFixes(all);
}

const browserOffset = (t: number) => -new Date(t).getTimezoneOffset();

/** Index of the last item whose key is ≤ t, or -1. */
function lastAtOrBefore<T>(items: T[], t: number, key: (x: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= t) (found = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  return found;
}

function index(fixes: Fix[], wall: boolean) {
  // Wall-clock photos are compared with each fix's local time, so a camera left on home time still lines up abroad.
  const key = (f: Fix, t: number) => (wall ? t + (f.off ?? browserOffset(t)) * MIN : t);
  const visits = fixes.filter((f) => f.end != null).map((f) => ({ s: key(f, f.t), e: key(f, f.end!), f }));
  visits.sort((a, b) => a.s - b.s);
  const points = fixes.flatMap((f) => (f.end != null && f.end !== f.t ? [{ k: key(f, f.t), f }, { k: key(f, f.end), f }] : [{ k: key(f, f.t), f }]));
  points.sort((a, b) => a.k - b.k);
  return { visits, points };
}

/**
 * Builds a lookup from photo time to place. A photo taken during a visit gets the visit's place;
 * otherwise it is interpolated between nearby path points, or snapped to one close in time.
 */
export function makeLocator(fixes: Fix[]): (p: Pick<Photo, 'takenAt' | 'wallClock'>) => Located | undefined {
  const byTime = index(fixes, false);
  const byWall = index(fixes, true);
  return (p) => {
    const { visits, points } = p.wallClock ? byWall : byTime;
    // A wall-clock time was read as if in this browser's zone; undo that to get the time as written.
    const t = p.wallClock ? p.takenAt + browserOffset(p.takenAt) * MIN : p.takenAt;

    // Visits nest (a café inside a city); pick the shortest one that contains the photo.
    let best: (typeof visits)[number] | undefined;
    const vi = lastAtOrBefore(visits, t, (v) => v.s);
    for (let i = vi; i >= 0 && i > vi - 20; i--) {
      const v = visits[i];
      if (v.e >= t && (!best || v.e - v.s < best.e - best.s)) best = v;
    }
    if (best) return { lat: best.f.lat, lng: best.f.lng, via: 'visit', method: 'visit', accuracyM: best.f.accuracyM };

    const i = lastAtOrBefore(points, t, (x) => x.k);
    const a = points[i];
    const b = points[i + 1];
    if (a && b && b.k - a.k <= INTERPOLATE_MS) {
      const f = b.k === a.k ? 0 : (t - a.k) / (b.k - a.k);
      return { lat: a.f.lat + (b.f.lat - a.f.lat) * f, lng: a.f.lng + (b.f.lng - a.f.lng) * f, via: 'path', method: 'interpolated', timeGapMs: Math.min(t - a.k, b.k - t) };
    }
    const near = [a, b].filter((x) => x && Math.abs(x.k - t) <= NEAREST_MS).sort((x, y) => Math.abs(x!.k - t) - Math.abs(y!.k - t))[0];
    return near ? { lat: near.f.lat, lng: near.f.lng, via: 'path', method: 'nearest', accuracyM: near.f.accuracyM, timeGapMs: Math.abs(near.k - t) } : undefined;
  };
}
