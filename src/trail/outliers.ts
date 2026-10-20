import type { Stop } from '../model/types';
import { metres } from './geo';

const MAX_KMH = 300;
const RETURN_M = 2000;

const kmh = (a: Stop, b: Stop) => {
  if (a.arrivedAt == null || b.arrivedAt == null) return 0;
  const h = Math.max(b.arrivedAt - a.arrivedAt, 60_000) / 3_600_000;
  return metres([a.lng, a.lat], [b.lng, b.lat]) / 1000 / h;
};

/**
 * Finds stops that look like GPS glitches: the photo "jumps" far away and straight back,
 * i.e. both legs imply an impossible speed while its neighbours are close to each other.
 * A genuine flight doesn't come back, so it isn't flagged.
 */
export function findOutliers(stops: Stop[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < stops.length - 1; i++) {
    const [a, b, c] = [stops[i - 1], stops[i], stops[i + 1]];
    if (kmh(a, b) > MAX_KMH && kmh(b, c) > MAX_KMH && metres([a.lng, a.lat], [c.lng, c.lat]) < RETURN_M) out.add(b.id);
  }
  return out;
}
