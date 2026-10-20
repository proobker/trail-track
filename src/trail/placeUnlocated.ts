import type { Photo, Stop } from '../model/types';

export interface Placement {
  photoId: string;
  lat: number;
  lng: number;
  /** Stop the photo was snapped to, if it fell outside any travel window. */
  stopId?: string;
}

/**
 * Places photos without GPS on the trail by their timestamp: between two timed stops the
 * position is linearly interpolated; before the first / after the last it snaps to that stop.
 */
export function placeUnlocated(photos: Photo[], stops: Stop[]): Placement[] {
  const timed = stops.filter((s) => s.arrivedAt != null).sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  if (timed.length === 0) return [];
  return photos.map((p) => {
    const t = p.takenAt;
    if (t <= timed[0].arrivedAt!) return snap(p, timed[0]);
    const last = timed[timed.length - 1];
    if (t >= last.arrivedAt!) return snap(p, last);
    let i = 1;
    while (timed[i].arrivedAt! < t) i++;
    const a = timed[i - 1];
    const b = timed[i];
    const f = (t - a.arrivedAt!) / (b.arrivedAt! - a.arrivedAt!);
    return { photoId: p.id, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  });
}

const snap = (p: Photo, s: Stop): Placement => ({ photoId: p.id, lat: s.lat, lng: s.lng, stopId: s.id });
