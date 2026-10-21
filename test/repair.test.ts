import { expect, it } from 'vitest';
import { newJourney } from '../src/trail/journey';
import { matchOriginals, repairJourneyDates } from '../src/trail/repair';
import type { Photo } from '../src/model/types';

const photo = (id: string): Photo => ({ id, fileName: 'IMG.jpg', source: 'upload', takenAt: new Date('2026-10-17T12:00').getTime(), people: ['Ana'] });

it('repairs undated saved journeys from loose photos and keeps their references', () => {
  const j = repairJourneyDates(newJourney('Trip', { loosePhotoIds: ['a'] }), new Map([['a', photo('a')]]));
  expect(j.dateFrom).toBe('2026-10-17');
  expect(j.dateTo).toBe('2026-10-17');
  expect(j.loosePhotoIds).toEqual(['a']);
  expect(j.stops).toEqual([]);
  expect(repairJourneyDates(j, new Map([['a', photo('a')]]))).toBe(j);
});

it('restores originals onto the same photo ids without losing known metadata', () => {
  const blob = new Blob(['image']);
  const [restored] = matchOriginals([photo('old')], [{ ...photo('new'), lat: 27.7, lng: 85.3, people: [], previewBlob: blob }]);
  expect(restored).toMatchObject({ id: 'old', lat: 27.7, lng: 85.3, people: ['Ana'], previewBlob: blob });
  expect(matchOriginals([photo('a'), photo('b')], [photo('new')])).toEqual([]);
});

it('recovers stop dates without changing existing times, places or segments', () => {
  const j = newJourney('Trip', { stops: [{ id: 'stop', lat: 27, lng: 85, photoIds: ['a'], origin: 'manual' }] });
  const fixed = repairJourneyDates(j, new Map([['a', photo('a')]]));
  expect(fixed.stops[0]).toEqual({ ...j.stops[0], arrivedAt: photo('a').takenAt });
  expect(fixed.segments).toBe(j.segments);
  expect(repairJourneyDates(fixed, new Map([['a', { ...photo('a'), takenAt: 0 }]])).stops[0].arrivedAt).toBe(photo('a').takenAt);
  expect(matchOriginals([{ ...photo('a'), lat: 1, lng: 2 }], [{ ...photo('b'), lat: 3, lng: 4 }])[0]).toMatchObject({ lat: 1, lng: 2 });
});
