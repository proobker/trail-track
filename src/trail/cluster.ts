import { uid, type Photo, type Stop } from '../model/types';
import { hasLocation } from './filter';
import { metres } from './geo';
import type { SceneEmbeddings } from '../import/sceneAnalysis';
import { nearDuplicate, sceneSimilarity } from './visual';

export interface ClusterOptions {
  /** Maximum distance from the first photo in a stop, in metres. */
  radiusM: number;
  /** Maximum time since the previous photo in the same stop. */
  gapMs: number;
}

export const DEFAULT_CLUSTER: ClusterOptions = { radiusM: 100, gapMs: 2 * 60 * 60_000 };

/** Turns time-ordered located photos into stops; consecutive nearby photos share one stop. */
export function clusterPhotos(photos: Photo[], opts: ClusterOptions = DEFAULT_CLUSTER, embeddings?: SceneEmbeddings): Stop[] {
  const located = photos.filter(hasLocation).sort((a, b) => a.takenAt - b.takenAt);
  const stops: (Stop & { n: number; lastAt: number; anchorLat: number; anchorLng: number; lastAccuracyM?: number; anchorAccuracyM?: number; hashes: string[]; featureIds: string[] })[] = [];
  for (const p of located) {
    const cur = stops.at(-1);
    if (cur) {
      const d = metres([cur.lng, cur.lat], [p.lng, p.lat]);
      const anchorD = metres([cur.anchorLng, cur.anchorLat], [p.lng, p.lat]);
      const sameScene = cur.hashes.some((hash) => nearDuplicate(hash, p.visualHash));
      const relatedScene = embeddings && cur.featureIds.some((id) => (sceneSimilarity(embeddings.get(id), embeddings.get(p.id)) ?? -1) >= 0.9);
      const limit = sameScene ? opts.radiusM * 2 : relatedScene ? opts.radiusM * 2.5 : opts.radiusM;
      // Two precise fixes separated by more than their error circles are likely distinct places,
      // even when they fit inside the broad default radius (e.g. parallel trails or switchbacks).
      const accuracyLimit = (a?: number) => a != null && p.locationAccuracyM != null
        ? Math.max(35, Math.min(limit, a + p.locationAccuracyM + 20)) : limit;
      const localLimit = sameScene ? limit : accuracyLimit(cur.lastAccuracyM);
      const anchorLimit = sameScene ? limit : accuracyLimit(cur.anchorAccuracyM);
      if (p.takenAt - cur.lastAt <= opts.gapMs && d <= localLimit && anchorD <= anchorLimit) {
        cur.lat = (cur.lat * cur.n + p.lat) / (cur.n + 1);
        cur.lng = (cur.lng * cur.n + p.lng) / (cur.n + 1);
        cur.n++;
        cur.lastAt = p.takenAt;
        cur.lastAccuracyM = p.locationAccuracyM;
        cur.photoIds.push(p.id);
        if (p.visualHash && cur.hashes.length < 16) cur.hashes.push(p.visualHash);
        if (embeddings?.has(p.id) && cur.featureIds.length < 16) cur.featureIds.push(p.id);
        continue;
      }
    }
    stops.push({ id: uid(), lat: p.lat, lng: p.lng, arrivedAt: p.takenAt, photoIds: [p.id], origin: 'photo', n: 1, lastAt: p.takenAt, anchorLat: p.lat, anchorLng: p.lng, lastAccuracyM: p.locationAccuracyM, anchorAccuracyM: p.locationAccuracyM, hashes: p.visualHash ? [p.visualHash] : [], featureIds: embeddings?.has(p.id) ? [p.id] : [] });
  }
  return stops.map(({ n: _n, lastAt: _l, anchorLat: _a, anchorLng: _b, lastAccuracyM: _la, anchorAccuracyM: _aa, hashes: _h, featureIds: _f, ...s }) => s);
}
