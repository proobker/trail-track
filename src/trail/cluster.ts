import { uid, type Photo, type Stop } from '../model/types';
import { hasLocation } from './filter';
import { metres } from './geo';

export interface ClusterOptions {
  /** Merge a photo into the current stop when within this distance of its centre. */
  radiusM: number;
  /** ...or when taken within this long of the stop's previous photo while still nearby (2× radius). */
  gapMs: number;
}

export const DEFAULT_CLUSTER: ClusterOptions = { radiusM: 150, gapMs: 20 * 60_000 };

/** Turns time-ordered located photos into stops; consecutive nearby photos share one stop. */
export function clusterPhotos(photos: Photo[], opts: ClusterOptions = DEFAULT_CLUSTER): Stop[] {
  const located = photos.filter(hasLocation).sort((a, b) => a.takenAt - b.takenAt);
  const stops: (Stop & { n: number; lastAt: number })[] = [];
  for (const p of located) {
    const cur = stops.at(-1);
    if (cur) {
      const d = metres([cur.lng, cur.lat], [p.lng, p.lat]);
      const recent = p.takenAt - cur.lastAt <= opts.gapMs;
      if (d <= opts.radiusM || (recent && d <= opts.radiusM * 2)) {
        cur.lat = (cur.lat * cur.n + p.lat) / (cur.n + 1);
        cur.lng = (cur.lng * cur.n + p.lng) / (cur.n + 1);
        cur.n++;
        cur.lastAt = p.takenAt;
        cur.photoIds.push(p.id);
        continue;
      }
    }
    stops.push({ id: uid(), lat: p.lat, lng: p.lng, arrivedAt: p.takenAt, photoIds: [p.id], origin: 'photo', n: 1, lastAt: p.takenAt });
  }
  return stops.map(({ n: _n, lastAt: _l, ...s }) => s);
}
