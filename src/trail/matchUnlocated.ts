import type { SceneEmbeddings } from '../import/sceneAnalysis';
import type { Photo, Stop } from '../model/types';
import { nearDuplicate, sceneSimilarity } from './visual';

const VISIT_WINDOW_MS = 2 * 60 * 60_000;
const MIN_SCENE_SIMILARITY = 0.94;
const MIN_WIN_MARGIN = 0.03;

/** Attach an unlocated image only when a known photo from this visit is a clear visual match. */
export function matchUnlocated(photos: Photo[], stops: Stop[], embeddings?: SceneEmbeddings): { stops: Stop[]; looseIds: string[]; matched: number } {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const result = stops.map((s) => ({ ...s, photoIds: [...s.photoIds] }));
  const known = stops.flatMap((stop, index) => stop.photoIds.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [{ photo, index }] : [];
  })).sort((a, b) => a.photo.takenAt - b.photo.takenAt);
  const looseIds: string[] = [];
  let matched = 0;

  for (const p of photos) {
    if (p.lat != null && p.lng != null) continue;
    const scores = new Map<number, number>();
    let lo = 0;
    let hi = known.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (known[mid].photo.takenAt < p.takenAt - VISIT_WINDOW_MS) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < known.length && known[i].photo.takenAt <= p.takenAt + VISIT_WINDOW_MS; i++) {
      const { photo: reference, index } = known[i];
      const score = nearDuplicate(p.visualHash, reference.visualHash)
        ? 1
        : sceneSimilarity(embeddings?.get(p.id), embeddings?.get(reference.id));
      if (score != null) scores.set(index, Math.max(scores.get(index) ?? -1, score));
    }
    const ranked = [...scores].map(([index, score]) => ({ score, index })).sort((a, b) => b.score - a.score);
    if (ranked[0] && ranked[0].score >= MIN_SCENE_SIMILARITY && ranked[0].score - (ranked[1]?.score ?? -1) >= MIN_WIN_MARGIN) {
      result[ranked[0].index].photoIds.push(p.id);
      matched++;
    } else {
      looseIds.push(p.id);
    }
  }
  return { stops: result, looseIds, matched };
}
