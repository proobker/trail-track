import { uid, type Photo, type Stop } from '../model/types';

/** Merges a stop into the one after it: photos combined, first stop's position and time kept. */
export function mergeWithNext(stops: Stop[], stopId: string): Stop[] {
  const i = stops.findIndex((s) => s.id === stopId);
  if (i < 0 || i >= stops.length - 1) return stops;
  const [a, b] = [stops[i], stops[i + 1]];
  const note = [a.note, b.note].filter(Boolean).join('\n\n') || undefined;
  const merged: Stop = { ...a, photoIds: [...a.photoIds, ...b.photoIds], note, label: a.label ?? b.label };
  return [...stops.slice(0, i), merged, ...stops.slice(i + 2)];
}

/**
 * Splits a stop's photos at the largest time gap into two stops. The second stop is placed at
 * the mean position of its photos when they have locations, otherwise at the original stop.
 */
export function splitStop(stops: Stop[], stopId: string, photos: Map<string, Photo>): Stop[] {
  const i = stops.findIndex((s) => s.id === stopId);
  const s = stops[i];
  if (!s || s.photoIds.length < 2) return stops;
  const sorted = [...s.photoIds].sort((x, y) => (photos.get(x)?.takenAt ?? 0) - (photos.get(y)?.takenAt ?? 0));
  let cut = 1;
  let gap = -1;
  for (let k = 1; k < sorted.length; k++) {
    const g = (photos.get(sorted[k])?.takenAt ?? 0) - (photos.get(sorted[k - 1])?.takenAt ?? 0);
    if (g > gap) [gap, cut] = [g, k];
  }
  const centre = (ids: string[], fallback: Stop) => {
    const located = ids.map((id) => photos.get(id)).filter((p): p is Photo & { lat: number; lng: number } => p?.lat != null && p?.lng != null);
    if (!located.length) return { lat: fallback.lat, lng: fallback.lng };
    return { lat: located.reduce((n, p) => n + p.lat, 0) / located.length, lng: located.reduce((n, p) => n + p.lng, 0) / located.length };
  };
  const firstIds = sorted.slice(0, cut);
  const secondIds = sorted.slice(cut);
  const first: Stop = { ...s, ...centre(firstIds, s), photoIds: firstIds };
  const second: Stop = {
    id: uid(),
    ...centre(secondIds, s),
    arrivedAt: photos.get(secondIds[0])?.takenAt ?? s.arrivedAt,
    photoIds: secondIds,
    origin: s.origin,
  };
  return [...stops.slice(0, i), first, second, ...stops.slice(i + 1)];
}
