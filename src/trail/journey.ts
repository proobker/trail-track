import { uid, type Journey, type Mode, type Segment, type Stop } from '../model/types';
import { inferMode } from './inferMode';
import { lineMetres, straightLine } from './geo';

/**
 * Rebuilds segments for consecutive stops. A segment survives when its endpoints are unchanged
 * and neither endpoint moved; otherwise a straight placeholder is created (mode kept if the pair
 * existed before, else inferred) and its id is returned in `needsRouting`.
 */
export function reconcileSegments(
  stops: Stop[],
  old: Segment[],
  movedStopIds: Set<string> = new Set(),
): { segments: Segment[]; needsRouting: string[] } {
  const byPair = new Map(old.map((s) => [`${s.fromStopId}>${s.toStopId}`, s]));
  const needsRouting: string[] = [];
  const segments: Segment[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const prev = byPair.get(`${a.id}>${b.id}`);
    if (prev && !movedStopIds.has(a.id) && !movedStopIds.has(b.id)) {
      segments.push(prev);
      continue;
    }
    const mode: Mode = prev?.mode ?? inferMode(a, b);
    const seg: Segment = { id: uid(), fromStopId: a.id, toStopId: b.id, mode, geometry: straightLine([a.lng, a.lat], [b.lng, b.lat]), routing: 'straight' };
    segments.push(seg);
    needsRouting.push(seg.id);
  }
  return { segments, needsRouting };
}

export function newJourney(title: string, partial: Partial<Journey> = {}): Journey {
  return { id: uid(), title, personFilter: { mode: 'any' }, stops: [], segments: [], updatedAt: Date.now(), ...partial };
}

export function journeyStats(j: Journey) {
  const byMode = new Map<Mode, number>();
  let total = 0;
  for (const s of j.segments) {
    const m = lineMetres(s.geometry.coordinates as [number, number][]);
    total += m;
    byMode.set(s.mode, (byMode.get(s.mode) ?? 0) + m);
  }
  const times = j.stops.map((s) => s.arrivedAt).filter((t): t is number => t != null && Number.isFinite(t));
  const dateTime = (day?: string) => {
    const t = day ? new Date(`${day}T12:00`).getTime() : NaN;
    return Number.isFinite(t) ? t : undefined;
  };
  return {
    totalKm: total / 1000,
    byMode,
    photoCount: j.stops.reduce((n, s) => n + s.photoIds.length, 0),
    loosePhotoCount: j.loosePhotoIds?.length ?? 0,
    start: times.length ? Math.min(...times) : dateTime(j.dateFrom ?? j.dateTo),
    end: times.length ? Math.max(...times) : dateTime(j.dateTo ?? j.dateFrom),
  };
}
