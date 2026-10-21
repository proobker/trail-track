import { describe, expect, it } from 'vitest';
import type { Photo, Stop } from '../src/model/types';
import { clusterPhotos } from '../src/trail/cluster';
import { filterPhotos, peopleIndex } from '../src/trail/filter';
import { inferMode } from '../src/trail/inferMode';
import { newJourney, reconcileSegments } from '../src/trail/journey';
import { DAY_MS, rangeTitle, splitIntoTrips, splitJourney, tripStarts } from '../src/trail/trips';
import { photoKind } from '../src/import/photoKind';
import { placeUnlocated } from '../src/trail/placeUnlocated';

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
  it('returns nothing without timed stops', () => {
    expect(placeUnlocated([photo({})], [stop({})])).toEqual([]);
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

describe('splitIntoTrips', () => {
  it('starts a new trip at gaps of at least the threshold', () => {
    const t = [0, 1, 2, 10, 11, 30].map((d) => d * DAY_MS);
    expect(splitIntoTrips(t, (x) => x, 3 * DAY_MS).map((g) => g.length)).toEqual([3, 2, 1]);
    expect(splitIntoTrips([...t].reverse(), (x) => x, 3 * DAY_MS)[0]).toEqual([0, DAY_MS, 2 * DAY_MS]);
    expect(splitIntoTrips(t, (x) => x, 100 * DAY_MS)).toHaveLength(1);
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
    expect(tripStarts(j, 3 * DAY_MS)).toEqual([{ index: 2, gapMs: 9 * DAY_MS }]);
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
