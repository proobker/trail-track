import type { PersonFilter, Photo } from '../model/types';

export interface PhotoQuery {
  dateFrom?: string;
  dateTo?: string;
  person: PersonFilter;
}

const dayStart = (d: string) => new Date(`${d}T00:00:00`).getTime();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

export function matchesQuery(photo: Photo, q: PhotoQuery): boolean {
  if (q.dateFrom && photo.takenAt < dayStart(q.dateFrom)) return false;
  if (q.dateTo && photo.takenAt > dayEnd(q.dateTo)) return false;
  switch (q.person.mode) {
    case 'any':
      return true;
    case 'none':
      return photo.people.length === 0;
    case 'person':
      return photo.people.includes(q.person.name);
  }
}

export function filterPhotos(photos: Photo[], q: PhotoQuery): Photo[] {
  return photos.filter((p) => matchesQuery(p, q));
}

/** Distinct person names with photo counts, most frequent first. */
export function peopleIndex(photos: Photo[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of photos) for (const n of p.people) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export const hasLocation = (p: Photo): p is Photo & { lat: number; lng: number } =>
  typeof p.lat === 'number' && typeof p.lng === 'number';
