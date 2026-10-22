import { metres } from './geo';
import { TREKS } from './treksData';

/** A well-known trek: its main stops in walking order, as [lat, lng, name]. */
export interface Trek {
  name: string;
  points: [number, number, string][];
}

/** A stop within this distance of a waypoint counts as visiting it. */
const WAYPOINT_M = 4_000;
/** A stop within this distance of the line through the waypoints is on the trek. */
const ROUTE_M = 5_000;
/** Of all stops, at least this share (or at least 3 stops) must be on the trek. */
const MIN_ON_ROUTE_SHARE = 0.4;

/** Distance from p to segment ab, in metres; fine at trek scale with a local flat projection. */
function toSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const [ax, ay, bx, by, px, py] = [a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]];
  const len = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len)) : 0;
  return metres([p[1], p[0]], [(ax + t * (bx - ax)) / k, ay + t * (by - ay)]);
}

/**
 * The known trek a journey's stops follow best, if any. A trek needs stops at two or more of its
 * waypoints and a good share of the journey along its route; the one with the most waypoints wins.
 */
export function matchTrek(stops: { lat: number; lng: number }[], treks: Trek[] = TREKS): Trek | undefined {
  if (stops.length < 2) return undefined;
  let best: { trek: Trek; score: number } | undefined;
  for (const trek of treks) {
    const visited = new Set<number>();
    let onRoute = 0;
    for (const s of stops) {
      const p: [number, number] = [s.lat, s.lng];
      trek.points.forEach(([lat, lng], i) => {
        if (metres([s.lng, s.lat], [lng, lat]) <= WAYPOINT_M) visited.add(i);
      });
      const line = trek.points.length === 1 ? [trek.points[0], trek.points[0]] : trek.points;
      let near = Infinity;
      for (let i = 1; i < line.length; i++) near = Math.min(near, toSegmentM(p, [line[i - 1][0], line[i - 1][1]], [line[i][0], line[i][1]]));
      if (near <= ROUTE_M) onRoute++;
    }
    if (visited.size < Math.min(2, trek.points.length)) continue;
    if (onRoute < 3 && onRoute < stops.length * MIN_ON_ROUTE_SHARE) continue;
    const score = visited.size + onRoute / stops.length;
    if (!best || score > best.score) best = { trek, score };
  }
  return best?.trek;
}
