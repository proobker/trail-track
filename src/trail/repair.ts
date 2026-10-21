import type { Journey, Photo } from '../model/types';
import { localDay } from './days';

/** Recover missing dates from referenced records, without inventing a location or changing the route. */
export function repairJourneyDates(j: Journey, photos: Map<string, Photo>): Journey {
  let changed = false;
  const stops = j.stops.map((s) => {
    if (s.arrivedAt != null && Number.isFinite(s.arrivedAt)) return s;
    const times = s.photoIds.map((id) => photos.get(id)?.takenAt).filter((t): t is number => t != null && Number.isFinite(t));
    if (!times.length) return s;
    changed = true;
    return { ...s, arrivedAt: Math.min(...times) };
  });
  const ids = [...stops.flatMap((s) => s.photoIds), ...(j.loosePhotoIds ?? [])];
  const times = ids.map((id) => photos.get(id)?.takenAt).filter((t): t is number => t != null && Number.isFinite(t));
  times.push(...stops.flatMap((s) => s.arrivedAt != null && Number.isFinite(s.arrivedAt) ? [s.arrivedAt] : []));
  const validDay = (day?: string) => !!day && Number.isFinite(Date.parse(`${day}T12:00`));
  const bounds = times.reduce(([lo, hi], t) => [Math.min(lo, t), Math.max(hi, t)], [Infinity, -Infinity]);
  const dateFrom = validDay(j.dateFrom) ? j.dateFrom : times.length ? localDay(bounds[0]) : j.dateFrom;
  const dateTo = validDay(j.dateTo) ? j.dateTo : times.length ? localDay(bounds[1]) : j.dateTo;
  return changed || dateFrom !== j.dateFrom || dateTo !== j.dateTo ? { ...j, stops, dateFrom, dateTo } : j;
}

/** Only unambiguous filenames can restore an existing record. Keep ids, people and known locations. */
export function matchOriginals(existing: Photo[], originals: Photo[]): Photo[] {
  const grouped = (items: Photo[]) => {
    const map = new Map<string, Photo[]>();
    for (const p of items) map.set(p.fileName, [...(map.get(p.fileName) ?? []), p]);
    return map;
  };
  const oldByName = grouped(existing);
  const newByName = grouped(originals);
  return existing.flatMap((old) => {
    const candidates = newByName.get(old.fileName);
    if (oldByName.get(old.fileName)?.length !== 1 || candidates?.length !== 1) return [];
    const fresh = candidates[0];
    const knownLocation = Number.isFinite(old.lat) && Number.isFinite(old.lng);
    return [{ ...old,
      lat: knownLocation ? old.lat : fresh.lat,
      lng: knownLocation ? old.lng : fresh.lng,
      locationSource: knownLocation ? old.locationSource : fresh.locationSource,
      locationAccuracyM: knownLocation ? old.locationAccuracyM : fresh.locationAccuracyM,
      locationAccuracyLevel: knownLocation ? old.locationAccuracyLevel : fresh.locationAccuracyLevel,
      originalLocation: fresh.originalLocation ?? old.originalLocation,
      thumbBlob: fresh.thumbBlob ?? old.thumbBlob,
      previewBlob: fresh.previewBlob ?? old.previewBlob,
      visualHash: fresh.visualHash ?? old.visualHash,
    }];
  });
}
