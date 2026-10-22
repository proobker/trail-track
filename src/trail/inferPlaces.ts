import type { GeoQuery, PlaceGuess } from '../import/geolocate';
import type { SceneEmbeddings } from '../import/sceneAnalysis';
import { trustedTime, uid, type Photo, type Segment, type Stop } from '../model/types';
import { hasLocation } from './filter';
import { matchUnlocated } from './matchUnlocated';
import { placeUnlocated } from './placeUnlocated';
import { sceneSimilarity } from './visual';

/** A trusted time inside a gap this short is interpolated along the leg when the model is unsure. */
const MAX_INTERPOLATE_GAP_MS = 6 * 60 * 60_000;
/** A trusted time this close before the first / after the last stop belongs to that stop. */
const EDGE_WINDOW_MS = 2 * 60 * 60_000;
/** Interpolated photos this close together share one new stop. */
const SHARED_STOP_MS = 20 * 60_000;
const TIMED_CONFIDENCE = { score: 0.5, margin: 0.15 };
const UNTIMED_CONFIDENCE = { score: 0.6, margin: 0.25 };
/** Labels per photo when the whole trip is a candidate; the most photographed places win. */
const MAX_LABELS = 64;

export interface PlaceQuery extends GeoQuery {
  /** Stop indexes behind each label (several stops can share a place name). */
  stopIndexes: number[][];
}

export interface PlaceSuggestion {
  photoId: string;
  stopId: string;
  score: number;
}

export interface InferResult {
  stops: Stop[];
  looseIds: string[];
  /** Photos whose location (and possibly time) was inferred; save these. */
  updated: Photo[];
  /** Unsure model picks, for the user to accept or ignore. */
  suggestions: PlaceSuggestion[];
  counts: { visual: number; ai: number; time: number; guess: number };
}

export const placeLabel = (s: Stop) => [s.place?.name, s.place?.city, s.place?.country].filter(Boolean).join(', ') || undefined;

const sortedTimed = (stops: Stop[]) => stops.map((s, i) => ({ s, i })).filter(({ s }) => s.arrivedAt != null).sort((a, b) => a.s.arrivedAt! - b.s.arrivedAt!);

/** Stop indexes a photo is ranked against: its time bracket (±1 stop) when trusted, else the whole trip. */
function candidateStops(p: Photo, stops: Stop[]): number[] {
  const timed = sortedTimed(stops);
  if (!trustedTime(p) || !timed.length) {
    return stops.map((s, i) => ({ i, n: s.photoIds.length })).sort((a, b) => b.n - a.n).map(({ i }) => i);
  }
  let b = timed.findIndex(({ s }) => s.arrivedAt! > p.takenAt);
  if (b < 0) b = timed.length;
  return timed.slice(Math.max(0, b - 2), b + 2).map(({ i }) => i);
}

/** Stops some unlocated photo could be ranked against; only these need a place name. */
export function candidateStopIds(photos: Photo[], stops: Stop[]): Set<string> {
  const ids = new Set<string>();
  for (const p of photos) if (!hasLocation(p)) for (const i of candidateStops(p, stops)) ids.add(stops[i].id);
  return ids;
}

/** Builds the labelled place lists the geolocation model ranks, one per photo without a location. */
export function placeQueries(photos: Photo[], stops: Stop[]): PlaceQuery[] {
  const queries: PlaceQuery[] = [];
  for (const photo of photos) {
    if (hasLocation(photo)) continue;
    const byLabel = new Map<string, number[]>();
    for (const i of candidateStops(photo, stops)) {
      const label = placeLabel(stops[i]);
      if (!label) continue;
      if (!byLabel.has(label) && byLabel.size >= MAX_LABELS) continue;
      byLabel.set(label, [...(byLabel.get(label) ?? []), i]);
    }
    // One label always wins with 100%, which says nothing.
    if (byLabel.size < 2) continue;
    queries.push({ photo, labels: [...byLabel.keys()], stopIndexes: [...byLabel.values()] });
  }
  return queries;
}

/**
 * Places photos without GPS using, in order: a clear visual match to a located photo, a confident
 * on-device geolocation pick among the trip's places, and finally the photo's time between the
 * stops around it. Times from file dates are never used for interpolation.
 */
export function inferPlaces(
  photos: Photo[],
  stops: Stop[],
  opts: {
    segments?: Segment[]; queries?: PlaceQuery[]; guesses?: PlaceGuess[]; embeddings?: SceneEmbeddings;
    /** Place every photo, using the best weak evidence as a rough guess instead of leaving it unplaced. */
    autoPin?: boolean;
  } = {},
): InferResult {
  const visual = matchUnlocated(photos, stops, opts.embeddings);
  const result = visual.stops;
  const byId = new Map(photos.map((p) => [p.id, p]));
  const updated: Photo[] = [];
  const suggestions: PlaceSuggestion[] = [];
  const counts = { visual: visual.matched, ai: 0, time: 0, guess: 0 };

  const before = new Set(stops.flatMap((s) => s.photoIds));
  for (const s of result) {
    for (const id of s.photoIds) {
      const p = byId.get(id);
      if (p && !before.has(id) && !hasLocation(p)) updated.push({ ...p, lat: s.lat, lng: s.lng, locationSource: 'inferred-visual' });
    }
  }

  const queries = new Map((opts.queries ?? []).map((q) => [q.photo.id, q]));
  const guesses = new Map((opts.guesses ?? []).map((g) => [g.photoId, g]));
  const timedStops = sortedTimed(result).map(({ s }) => s);
  const added: Stop[] = [];
  const looseIds: string[] = [];

  for (const id of visual.looseIds) {
    const p = byId.get(id);
    if (!p) continue;
    const timed = trustedTime(p);
    const query = queries.get(id);
    const guess = guesses.get(id);
    const options = query && guess ? query.stopIndexes[guess.candidateIndex] : undefined;
    // Several stops can share a name: take the one nearest in time, or the most photographed one.
    const pick = options?.length
      ? options.reduce((a, b) => (timed
        ? Math.abs((result[b].arrivedAt ?? Infinity) - p.takenAt) < Math.abs((result[a].arrivedAt ?? Infinity) - p.takenAt)
        : result[b].photoIds.length > result[a].photoIds.length) ? b : a)
      : undefined;
    const need = timed ? TIMED_CONFIDENCE : UNTIMED_CONFIDENCE;

    if (pick != null && guess && guess.score >= need.score && guess.margin >= need.margin) {
      const stop = result[pick];
      stop.photoIds.push(id);
      updated.push({
        ...p, lat: stop.lat, lng: stop.lng, locationSource: 'inferred-ai', placementScore: guess.score,
        ...(timed || stop.arrivedAt == null ? {} : { takenAt: stop.arrivedAt, timeEstimated: true }),
      });
      counts.ai++;
      continue;
    }

    const byTime = timed ? placeByTime(p, timedStops, opts.segments ?? []) : undefined;
    if (byTime?.stopId) {
      result.find((s) => s.id === byTime.stopId)!.photoIds.push(id);
    } else if (byTime) {
      added.push({ id: uid(), lat: byTime.lat, lng: byTime.lng, arrivedAt: p.takenAt, photoIds: [id], origin: 'photo' });
    }
    if (byTime) {
      updated.push({ ...p, lat: byTime.lat, lng: byTime.lng, locationSource: 'inferred-time' });
      counts.time++;
      continue;
    }

    const rough = opts.autoPin ? roughGuess(p, result, timedStops, opts.segments ?? [], pick, opts.embeddings) : undefined;
    if (rough) {
      if (rough.stop) rough.stop.photoIds.push(id);
      else added.push({ id: uid(), lat: rough.lat, lng: rough.lng, arrivedAt: p.takenAt, photoIds: [id], origin: 'photo' });
      updated.push({
        ...p, lat: rough.lat, lng: rough.lng, locationSource: 'inferred-guess', placementScore: guess && pick != null ? guess.score : undefined,
        ...(timed || rough.stop?.arrivedAt == null ? {} : { takenAt: rough.stop.arrivedAt, timeEstimated: true }),
      });
      counts.guess++;
      continue;
    }

    looseIds.push(id);
    if (pick != null && guess) suggestions.push({ photoId: id, stopId: result[pick].id, score: guess.score });
  }

  return { stops: mergeAdded(result, added), looseIds, updated, suggestions, counts };
}

/**
 * The best weak evidence, in order: the model's unsure pick, the photo's trusted time with no gap
 * limit, the most similar-looking stop, and finally the stop nearest in (possibly unreliable) time.
 */
function roughGuess(p: Photo, stops: Stop[], timed: Stop[], segments: Segment[], pick: number | undefined, embeddings?: SceneEmbeddings): { lat: number; lng: number; stop?: Stop } | undefined {
  if (!stops.length) return undefined;
  if (pick != null) return { lat: stops[pick].lat, lng: stops[pick].lng, stop: stops[pick] };
  if (trustedTime(p)) {
    const byTime = placeByTime(p, timed, segments, true);
    if (byTime) return { lat: byTime.lat, lng: byTime.lng, stop: stops.find((s) => s.id === byTime.stopId) };
  }
  const mine = embeddings?.get(p.id);
  if (mine) {
    let best: { stop: Stop; score: number } | undefined;
    for (const stop of stops) {
      for (const id of stop.photoIds) {
        const score = sceneSimilarity(mine, embeddings!.get(id));
        if (score != null && (!best || score > best.score)) best = { stop, score };
      }
    }
    if (best) return { lat: best.stop.lat, lng: best.stop.lng, stop: best.stop };
  }
  const nearest = timed.length
    ? timed.reduce((a, b) => (Math.abs(b.arrivedAt! - p.takenAt) < Math.abs(a.arrivedAt! - p.takenAt) ? b : a))
    : stops[0];
  return { lat: nearest.lat, lng: nearest.lng, stop: nearest };
}

function placeByTime(p: Photo, timed: Stop[], segments: Segment[], anyGap = false) {
  if (!timed.length) return undefined;
  const first = timed[0];
  const last = timed[timed.length - 1];
  if (p.takenAt <= first.arrivedAt!) return anyGap || first.arrivedAt! - p.takenAt <= EDGE_WINDOW_MS ? { lat: first.lat, lng: first.lng, stopId: first.id } : undefined;
  if (p.takenAt >= last.arrivedAt!) return anyGap || p.takenAt - last.arrivedAt! <= EDGE_WINDOW_MS ? { lat: last.lat, lng: last.lng, stopId: last.id } : undefined;
  const b = timed.findIndex((s) => s.arrivedAt! > p.takenAt);
  if (!anyGap && timed[b].arrivedAt! - timed[b - 1].arrivedAt! > MAX_INTERPOLATE_GAP_MS) return undefined;
  const [placement] = placeUnlocated([p], { id: '', title: '', personFilter: { mode: 'any' }, stops: timed, segments, updatedAt: 0 });
  return placement ? { lat: placement.lat, lng: placement.lng, stopId: placement.stopId } : undefined;
}

/** Inserts interpolated stops in time order; ones a few minutes apart become one stop. */
function mergeAdded(stops: Stop[], added: Stop[]): Stop[] {
  if (!added.length) return stops;
  added.sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  const merged: Stop[] = [];
  for (const s of added) {
    const prev = merged.at(-1);
    if (prev && s.arrivedAt! - prev.arrivedAt! <= SHARED_STOP_MS) {
      const n = prev.photoIds.length;
      prev.lat = (prev.lat * n + s.lat) / (n + 1);
      prev.lng = (prev.lng * n + s.lng) / (n + 1);
      prev.photoIds.push(...s.photoIds);
    } else {
      merged.push(s);
    }
  }
  const all = [...stops, ...merged];
  // Keep chronological order when every stop has a time; otherwise append.
  if (all.every((s) => s.arrivedAt != null)) all.sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  return all;
}
