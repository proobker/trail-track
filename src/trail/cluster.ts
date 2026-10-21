import { uid, type Photo, type Stop } from '../model/types';
import { hasLocation } from './filter';
import { metres } from './geo';

export interface ClusterOptions {
  /** Maximum distance from the first photo in a stop, in metres. */
  radiusM: number;
  /** Maximum time since the previous photo in the same stop. */
  gapMs: number;
}

export const DEFAULT_CLUSTER: ClusterOptions = { radiusM: 100, gapMs: 2 * 60 * 60_000 };

/** A difference hash only proves that two frames are nearly identical, never that a place has a name. */
function nearDuplicate(a?: string, b?: string): boolean {
  if (!a || !b || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return false;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let changed = 0;
  while (bits) {
    bits &= bits - 1n;
    changed++;
  }
  return changed <= 6;
}

/** Turns time-ordered located photos into stops; consecutive nearby photos share one stop. */
export function clusterPhotos(photos: Photo[], opts: ClusterOptions = DEFAULT_CLUSTER): Stop[] {
  const located = photos.filter(hasLocation).sort((a, b) => a.takenAt - b.takenAt);
  const stops: (Stop & { n: number; lastAt: number; anchorLat: number; anchorLng: number; hashes: string[] })[] = [];
  for (const p of located) {
    const cur = stops.at(-1);
    if (cur) {
      const d = metres([cur.lng, cur.lat], [p.lng, p.lat]);
      const anchorD = metres([cur.anchorLng, cur.anchorLat], [p.lng, p.lat]);
      const sameScene = cur.hashes.some((hash) => nearDuplicate(hash, p.visualHash));
      const limit = sameScene ? opts.radiusM * 2 : opts.radiusM;
      if (p.takenAt - cur.lastAt <= opts.gapMs && d <= limit && anchorD <= limit) {
        cur.lat = (cur.lat * cur.n + p.lat) / (cur.n + 1);
        cur.lng = (cur.lng * cur.n + p.lng) / (cur.n + 1);
        cur.n++;
        cur.lastAt = p.takenAt;
        cur.photoIds.push(p.id);
        if (p.visualHash && cur.hashes.length < 16) cur.hashes.push(p.visualHash);
        continue;
      }
    }
    stops.push({ id: uid(), lat: p.lat, lng: p.lng, arrivedAt: p.takenAt, photoIds: [p.id], origin: 'photo', n: 1, lastAt: p.takenAt, anchorLat: p.lat, anchorLng: p.lng, hashes: p.visualHash ? [p.visualHash] : [] });
  }
  return stops.map(({ n: _n, lastAt: _l, anchorLat: _a, anchorLng: _b, hashes: _h, ...s }) => s);
}
