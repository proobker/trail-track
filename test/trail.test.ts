import { describe, expect, it } from 'vitest';
import type { Photo, Stop } from '../src/model/types';
import { clusterPhotos } from '../src/trail/cluster';
import { filterPhotos, peopleIndex } from '../src/trail/filter';
import { inferMode } from '../src/trail/inferMode';
import { newJourney, reconcileSegments } from '../src/trail/journey';
import { DAY_MS, findHome, groupTrips, journeyTrips, rangeTitle, splitJourney, type TripPoint } from '../src/trail/trips';
import { photoKind } from '../src/import/photoKind';
import { placeUnlocated } from '../src/trail/placeUnlocated';
import { matchUnlocated } from '../src/trail/matchUnlocated';

const H = 3_600_000;
const T0 = Date.parse('2026-05-01T08:00:00');
let n = 0;
const photo = (p: Partial<Photo>): Photo => ({ id: `p${n++}`, source: 'upload', takenAt: T0, people: [], fileName: 'x.jpg', ...p });
const stop = (p: Partial<Stop>): Stop => ({ id: `s${n++}`, lat: 0, lng: 0, photoIds: [], origin: 'manual', ...p });

describe('filterPhotos', () => {
  const photos = [
    photo({ takenAt: Date.parse('2026-05-01T10:00:00'), people: ['Ana'] }),
    photo({ takenAt: Date.parse('2026-05-02T10:00:00'), people: [] }),
    photo({ takenAt: Date.parse('2026-05-03T23:30:00'), people: ['Ana', 'Ben'] }),
  ];
  it('filters by inclusive local date range', () => {
    expect(filterPhotos(photos, { dateFrom: '2026-05-02', dateTo: '2026-05-03', person: { mode: 'any' } })).toHaveLength(2);
  });
  it('keeps only photos without people', () => {
    expect(filterPhotos(photos, { person: { mode: 'none' } })).toEqual([photos[1]]);
  });
  it('keeps photos containing a person', () => {
    expect(filterPhotos(photos, { person: { mode: 'person', name: 'Ana' } })).toHaveLength(2);
  });
  it('indexes people by frequency', () => {
    expect(peopleIndex(photos)).toEqual([
      { name: 'Ana', count: 2 },
      { name: 'Ben', count: 1 },
    ]);
  });
});

describe('clusterPhotos', () => {
  it('merges nearby consecutive photos and splits distant ones', () => {
    const stops = clusterPhotos([
      photo({ lat: 48.8584, lng: 2.2945, takenAt: T0 }),
      photo({ lat: 48.8586, lng: 2.2947, takenAt: T0 + 5 * 60_000 }),
      photo({ lat: 48.8606, lng: 2.3376, takenAt: T0 + H }),
      photo({ takenAt: T0 + 2 * H }), // unlocated, ignored
    ]);
    expect(stops).toHaveLength(2);
    expect(stops[0].photoIds).toHaveLength(2);
    expect(stops[0].arrivedAt).toBe(T0);
  });
  it('orders by time regardless of input order', () => {
    const stops = clusterPhotos([photo({ lat: 10, lng: 10, takenAt: T0 + H }), photo({ lat: 0, lng: 0, takenAt: T0 })]);
    expect(stops.map((s) => s.lat)).toEqual([0, 10]);
  });
  it('keeps separate visits to the same coordinates on different days', () => {
    const stops = clusterPhotos([
      photo({ lat: 27.7172, lng: 85.324, takenAt: T0 }),
      photo({ lat: 27.7172, lng: 85.324, takenAt: T0 + DAY_MS }),
    ]);
    expect(stops).toHaveLength(2);
  });
  it('separates nearby venues and does not drift through a chain of photos', () => {
    const stops = clusterPhotos([
      photo({ lat: 0, lng: 0, takenAt: T0 }),
      photo({ lat: 0, lng: 0.0007, takenAt: T0 + 5 * 60_000 }),
      photo({ lat: 0, lng: 0.0014, takenAt: T0 + 10 * 60_000 }),
    ]);
    expect(stops.map((s) => s.photoIds.length)).toEqual([2, 1]);
  });
  it('keeps separate precise fixes on nearby parallel paths', () => {
    const a = photo({ lat: 0, lng: 0, locationAccuracyM: 10, takenAt: T0 });
    const b = photo({ lat: 0, lng: 0.00075, locationAccuracyM: 10, takenAt: T0 + 10 * 60_000 });
    expect(clusterPhotos([a, b])).toHaveLength(2);
  });
  it('uses a local near-duplicate fingerprint to tolerate modest GPS drift', () => {
    const first = photo({ lat: 0, lng: 0, visualHash: '0f0f0f0f0f0f0f0f', takenAt: T0 });
    const duplicate = photo({ lat: 0, lng: 0.0013, visualHash: '0f0f0f0f0f0f0f0e', takenAt: T0 + 5 * 60_000 });
    const different = photo({ lat: 0, lng: 0.0013, visualHash: 'f0f0f0f0f0f0f0f0', takenAt: T0 + 5 * 60_000 });
    expect(clusterPhotos([first, duplicate])).toHaveLength(1);
    expect(clusterPhotos([first, different])).toHaveLength(2);
  });
  it('uses optional on-device scene similarity only for nearby photos in the same visit', () => {
    const first = photo({ lat: 0, lng: 0, takenAt: T0 });
    const related = photo({ lat: 0, lng: 0.0016, takenAt: T0 + 5 * 60_000 });
    const later = photo({ lat: 0, lng: 0.0016, takenAt: T0 + DAY_MS });
    const embeddings = new Map([
      [first.id, new Float32Array([1, 0])],
      [related.id, new Float32Array([0.95, Math.sqrt(1 - 0.95 ** 2)])],
      [later.id, new Float32Array([1, 0])],
    ]);
    expect(clusterPhotos([first, related])).toHaveLength(2);
    expect(clusterPhotos([first, related], undefined, embeddings)).toHaveLength(1);
    expect(clusterPhotos([first, later], undefined, embeddings)).toHaveLength(2);
    embeddings.set(related.id, new Float32Array([0, 1]));
    expect(clusterPhotos([first, related], undefined, embeddings)).toHaveLength(2);
  });
});

describe('inferMode', () => {
  const a = stop({ lat: 0, lng: 0, arrivedAt: T0 });
  it('walks at walking pace', () => expect(inferMode(a, stop({ lat: 0.02, lng: 0, arrivedAt: T0 + H }))).toBe('walk'));
  it('drives at road speed', () => expect(inferMode(a, stop({ lat: 0.7, lng: 0, arrivedAt: T0 + H }))).toBe('car'));
  it('flies long distances', () => expect(inferMode(a, stop({ lat: 10, lng: 0, arrivedAt: T0 + 2 * H }))).toBe('flight'));
  it('falls back on distance without times', () => expect(inferMode(stop({}), stop({ lat: 0.001 }))).toBe('walk'));
  it('ignores speed across an overnight gap', () => expect(inferMode(a, stop({ lat: 0.27, lng: 0, arrivedAt: T0 + 17 * H }))).toBe('car'));
});

describe('placeUnlocated', () => {
  const stops = [stop({ lat: 0, lng: 0, arrivedAt: T0 }), stop({ lat: 10, lng: 20, arrivedAt: T0 + 2 * H })];
  it('interpolates between timed stops', () => {
    const [p] = placeUnlocated([photo({ takenAt: T0 + H })], stops);
    expect(p.lat).toBeCloseTo(5);
    expect(p.lng).toBeCloseTo(10);
    expect(p.stopId).toBeUndefined();
  });
  it('snaps to the ends outside the time window', () => {
    const [before, after] = placeUnlocated([photo({ takenAt: T0 - H }), photo({ takenAt: T0 + 5 * H })], stops);
    expect(before.stopId).toBe(stops[0].id);
    expect(after.stopId).toBe(stops[1].id);
  });
  it('places a photo by distance along a shaped route', () => {
    const j = newJourney('Bend', { stops });
    j.segments = [{ id: 'bend', fromStopId: stops[0].id, toStopId: stops[1].id, mode: 'walk', routing: 'imported', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 10], [20, 10]] } }];
    const [placed] = placeUnlocated([photo({ takenAt: T0 + H })], j);
    expect(placed.method).toBe('route');
    expect(placed.lat).toBeCloseTo(10);
    expect(placed.lng).toBeGreaterThan(0);
    expect(placed.lng).toBeLessThan(20);
  });
  it('returns nothing without timed stops', () => {
    expect(placeUnlocated([photo({})], [stop({})])).toEqual([]);
  });
});

describe('matchUnlocated', () => {
  it('attaches a near-duplicate to a located photo from the same visit', () => {
    const known = photo({ lat: 0, lng: 0, visualHash: '0f0f0f0f0f0f0f0f', takenAt: T0 });
    const missing = photo({ visualHash: '0f0f0f0f0f0f0f0e', takenAt: T0 + 5 * 60_000 });
    const s = stop({ photoIds: [known.id], arrivedAt: T0 });
    const result = matchUnlocated([known, missing], [s]);
    expect(result.stops[0].photoIds).toEqual([known.id, missing.id]);
    expect(result.looseIds).toEqual([]);
    expect(result.matched).toBe(1);
  });
  it('uses scene embeddings only when the match is clear and close in time', () => {
    const a = photo({ lat: 0, lng: 0, takenAt: T0 });
    const b = photo({ lat: 0, lng: 1, takenAt: T0 });
    const missing = photo({ takenAt: T0 + 5 * 60_000 });
    const late = photo({ takenAt: T0 + DAY_MS });
    const s1 = stop({ photoIds: [a.id], arrivedAt: T0 });
    const s2 = stop({ photoIds: [b.id], arrivedAt: T0 });
    const embeddings = new Map([
      [a.id, new Float32Array([1, 0])],
      [b.id, new Float32Array([0, 1])],
      [missing.id, new Float32Array([0.98, Math.sqrt(1 - 0.98 ** 2)])],
      [late.id, new Float32Array([1, 0])],
    ]);
    const result = matchUnlocated([a, b, missing, late], [s1, s2], embeddings);
    expect(result.stops[0].photoIds).toEqual([a.id, missing.id]);
    expect(result.looseIds).toEqual([late.id]);
    embeddings.set(b.id, new Float32Array([1, 0]));
    expect(matchUnlocated([a, b, missing], [s1, s2], embeddings).looseIds).toEqual([missing.id]);
  });
});

describe('reconcileSegments', () => {
  it('keeps untouched segments and re-creates moved ones with the same mode', () => {
    const s = [stop({ lat: 0 }), stop({ lat: 0.01 }), stop({ lat: 0.02 })];
    const first = reconcileSegments(s, []);
    expect(first.segments).toHaveLength(2);
    expect(first.needsRouting).toHaveLength(2);
    const withBike = first.segments.map((x, i) => (i === 1 ? { ...x, mode: 'bike' as const } : x));
    const second = reconcileSegments(s, withBike, new Set([s[2].id]));
    expect(second.segments[0]).toBe(withBike[0]);
    expect(second.segments[1].mode).toBe('bike');
    expect(second.needsRouting).toEqual([second.segments[1].id]);
  });
});

describe('trips', () => {
  const KTM = { lat: 27.7172, lng: 85.324 };
  const POKHARA = { lat: 28.2096, lng: 83.9856 };
  const PARIS = { lat: 48.8566, lng: 2.3522 };
  const start = Date.UTC(2024, 0, 1, 4);
  /** Three months of near-daily photos at home in Kathmandu, with a Pokhara trip and a Europe trip. */
  const library: TripPoint[] = [];
  for (let d = 0; d < 90; d++) {
    const where = d >= 20 && d < 24 ? POKHARA : d >= 50 && d < 60 ? PARIS : KTM;
    library.push({ t: start + d * DAY_MS, ...where }, { t: start + d * DAY_MS + 3 * 3_600_000, ...where });
  }
  library.push({ t: start + 52 * DAY_MS + 3_600_000 });

  it('cannot see trips by time gaps alone when there are photos every day', () => {
    expect(groupTrips(library, (p) => p, 3 * DAY_MS)).toHaveLength(1);
  });

  it('finds home as the most photographed area', () => {
    const home = findHome(library)!;
    expect(home.lat).toBeCloseTo(KTM.lat, 1);
    expect(home.days).toBe(76);
  });

  it('treats the times away from home as trips', () => {
    const groups = groupTrips(library, (p) => p, 3 * DAY_MS, findHome(library));
    expect(groups.map((g) => [g.home, g.items.length, g.reason])).toEqual([
      [true, 40, undefined],
      [false, 8, 'left'],
      [true, 52, 'back'],
      [false, 21, 'left'],
      [true, 60, 'back'],
    ]);
  });

  it('has no home for a single trip, however spread out', () => {
    const trip = [0, 1, 2, 5, 6].map((d) => ({ t: start + d * DAY_MS, ...(d < 3 ? PARIS : KTM) }));
    expect(findHome(trip)).toBeUndefined();
    expect(groupTrips(trip, (p) => p, 3 * DAY_MS).map((g) => g.items.length)).toEqual([3, 2]);
  });

  it('offers cuts for an existing journey that mixes home and trips', () => {
    const stops: Stop[] = library
      .filter((p) => p.lat != null)
      .map((p, i) => ({ id: `s${i}`, lat: p.lat!, lng: p.lng!, arrivedAt: p.t, photoIds: [], origin: 'photo' }));
    const { cuts, homeParts } = journeyTrips(newJourney('Everything', { stops }));
    expect(cuts.map((c) => c.reason)).toEqual(['left', 'back', 'left', 'back']);
    expect(homeParts).toEqual([true, false, true, false, true]);
    const parts = splitJourney(newJourney('Everything', { stops }), cuts.map((c) => c.index), () => undefined, homeParts);
    expect(parts.map((x) => x.title.startsWith('At home'))).toEqual(homeParts);
    expect(parts[1].stops).toHaveLength(8);
  });

  it('joins two trips separated by a short layover at home', () => {
    const home = { ...KTM, days: 30 };
    const pts = [
      { t: 0, ...POKHARA },
      { t: 3_600_000, ...KTM },
      { t: 4 * 3_600_000, ...PARIS },
    ];
    expect(groupTrips(pts, (p) => p, 3 * DAY_MS, home).map((g) => [g.home, g.items.length])).toEqual([[false, 3]]);
  });
});

describe('splitJourney', () => {
  const stop = (id: string, day: number): Stop => ({ id, lat: day, lng: 0, arrivedAt: day * DAY_MS, photoIds: [], origin: 'photo' });
  const j = newJourney('2024-05-01 → 2024-05-20', {
    dateFrom: '2024-05-01',
    dateTo: '2024-05-20',
    stops: [stop('a', 0), stop('b', 1), stop('c', 10), stop('d', 11)],
    loosePhotoIds: ['early', 'late', 'unknown'],
  });
  j.segments = reconcileSegments(j.stops, []).segments;

  it('finds trip starts and cuts there, dropping the leg across the cut', () => {
    expect(journeyTrips(j).cuts).toEqual([{ index: 2, reason: 'gap', gapMs: 9 * DAY_MS }]);
    const times: Record<string, number> = { early: DAY_MS / 2, late: 10.5 * DAY_MS };
    const [first, second] = splitJourney(j, [2], (id) => times[id]);
    expect(first.id).toBe(j.id);
    expect(second.id).not.toBe(j.id);
    expect(first.stops.map((s) => s.id)).toEqual(['a', 'b']);
    expect(second.stops.map((s) => s.id)).toEqual(['c', 'd']);
    expect(first.segments).toHaveLength(1);
    expect(second.segments).toHaveLength(1);
    expect(first.loosePhotoIds).toEqual(['early', 'unknown']);
    expect(second.loosePhotoIds).toEqual(['late']);
  });

  it('renames auto-named journeys by date and numbers custom names', () => {
    const [a, b] = splitJourney(j, [2], () => undefined);
    expect(a.title).toBe(rangeTitle(a.dateFrom!, a.dateTo!));
    expect(b.title).toBe(rangeTitle(b.dateFrom!, b.dateTo!));
    const named = splitJourney({ ...j, title: 'Europe' }, [2], () => undefined);
    expect(named.map((x) => x.title)).toEqual(['Europe', 'Europe (2)']);
  });
});

describe('photoKind', () => {
  it('recognises junk by name and phone folder', () => {
    expect(photoKind({ fileName: 'Screenshot_20240512-093015.png' })).toBe('screenshot');
    expect(photoKind({ fileName: 'IMG_1.jpg', folder: 'Screenshots' })).toBe('screenshot');
    expect(photoKind({ fileName: 'CamScanner 05-12-2024.jpg' })).toBe('document');
    expect(photoKind({ fileName: 'IMG_2.jpg', folder: 'Scans' })).toBe('document');
    expect(photoKind({ fileName: 'IMG-20240512-WA0003.jpg' })).toBe('chat');
    expect(photoKind({ fileName: 'IMG_3.jpg', folder: 'WhatsApp Images' })).toBe('chat');
    expect(photoKind({ fileName: 'FB_IMG_1715506215000.jpg' })).toBe('saved');
    expect(photoKind({ fileName: 'x.jpg', folder: 'Download' })).toBe('saved');
  });
  it('treats ordinary camera photos as camera', () => {
    expect(photoKind({ fileName: 'PXL_20240512_093015123.jpg', folder: 'Camera' })).toBe('camera');
    expect(photoKind({ fileName: 'IMG_1234.HEIC' })).toBe('camera');
  });
});
