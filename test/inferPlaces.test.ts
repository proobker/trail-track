import { describe, expect, it } from 'vitest';
import { rankLabels, type PlaceGuess } from '../src/import/geolocate';
import { timeFromFileName } from '../src/import/fileNameDate';
import { parseSidecar } from '../src/import/takeoutSidecar';
import { trustedTime, type Photo, type Stop } from '../src/model/types';
import { inferPlaces, placeQueries } from '../src/trail/inferPlaces';

const H = 3_600_000;
const T0 = Date.parse('2026-05-01T08:00:00');
let n = 0;
const photo = (p: Partial<Photo>): Photo => ({ id: `p${n++}`, source: 'upload', takenAt: T0, people: [], fileName: 'x.jpg', ...p });
const stop = (city: string, lat: number, at: number, photoIds: string[] = []): Stop =>
  ({ id: `s${n++}`, lat, lng: lat, arrivedAt: at, photoIds, origin: 'photo', place: { city, country: 'Portugal' } });

/** Four stops two hours apart: Lisbon → Sintra → Cascais → Estoril. */
function trip() {
  const located = [0, 1, 2, 3].map((i) => photo({ takenAt: T0 + i * 2 * H, lat: i, lng: i, timeSource: 'exif' }));
  const stops = ['Lisbon', 'Sintra', 'Cascais', 'Estoril'].map((c, i) => stop(c, i, T0 + i * 2 * H, [located[i].id]));
  return { located, stops };
}
const guessFor = (q: { photo: Photo; labels: string[] }, label: string, score: number, margin = score): PlaceGuess =>
  ({ photoId: q.photo.id, candidateIndex: q.labels.indexOf(label), score, margin });

describe('time provenance', () => {
  it('trusts EXIF, sidecar and timed file names only', () => {
    expect(trustedTime(photo({ timeSource: 'exif' }))).toBe(true);
    expect(trustedTime(photo({ timeSource: 'filename' }))).toBe(true);
    expect(trustedTime(photo({ timeSource: 'filename-date' }))).toBe(false);
    expect(trustedTime(photo({ timeSource: 'file' }))).toBe(false);
    expect(trustedTime(photo({}))).toBe(false);
    expect(trustedTime(photo({ timeSource: 'exif', timeEstimated: true }))).toBe(false);
  });
  it('tells timed file names from date-only ones', () => {
    expect(timeFromFileName('IMG_20240512_093015.jpg')?.hasTime).toBe(true);
    expect(timeFromFileName('IMG-20240512-WA0003.jpg')?.hasTime).toBe(false);
  });
  it('marks Takeout upload time as untrusted', () => {
    expect(parseSidecar({ photoTakenTime: { timestamp: '1' } })?.timeSource).toBe('sidecar');
    expect(parseSidecar({ creationTime: { timestamp: '1' } })?.timeSource).toBe('file');
  });
});

describe('placeQueries', () => {
  it('ranks a trusted photo only against the stops around its time', () => {
    const { located, stops } = trip();
    const p = photo({ takenAt: T0 + 5 * H, timeSource: 'exif' });
    const [q] = placeQueries([...located, p], stops);
    // Between Cascais (4 h) and Estoril (6 h), plus one stop on the side that exists.
    expect(q.labels).toEqual(['Sintra, Portugal', 'Cascais, Portugal', 'Estoril, Portugal']);
  });
  it('ranks an untrusted photo against the whole trip', () => {
    const { located, stops } = trip();
    const [q] = placeQueries([...located, photo({ timeSource: 'file' })], stops);
    expect(q.labels).toHaveLength(4);
  });
});

describe('inferPlaces', () => {
  it('attaches a trusted photo to the stop the model picks', () => {
    const { located, stops } = trip();
    const p = photo({ takenAt: T0 + 3 * H, timeSource: 'exif' });
    const queries = placeQueries([...located, p], stops);
    const r = inferPlaces([...located, p], stops, { queries, guesses: [guessFor(queries[0], 'Cascais, Portugal', 0.8)] });
    expect(r.stops.find((s) => s.place?.city === 'Cascais')!.photoIds).toContain(p.id);
    expect(r.updated[0]).toMatchObject({ id: p.id, locationSource: 'inferred-ai', takenAt: p.takenAt });
    expect(r.counts.ai).toBe(1);
  });
  it('interpolates a trusted photo when the model is unsure and the gap is short', () => {
    const { located, stops } = trip();
    const p = photo({ takenAt: T0 + 3 * H, timeSource: 'exif' });
    const queries = placeQueries([...located, p], stops);
    const r = inferPlaces([...located, p], stops, { queries, guesses: [guessFor(queries[0], 'Cascais, Portugal', 0.3, 0.05)] });
    expect(r.stops).toHaveLength(5);
    const added = r.stops.find((s) => s.photoIds.includes(p.id))!;
    expect(added.lat).toBeCloseTo(1.5);
    expect(r.stops.indexOf(added)).toBe(2);
    expect(r.updated[0].locationSource).toBe('inferred-time');
  });
  it('leaves a trusted photo in a long gap unplaced, with a suggestion', () => {
    const located = [photo({ lat: 0, lng: 0, timeSource: 'exif' }), photo({ takenAt: T0 + 24 * H, lat: 1, lng: 1, timeSource: 'exif' })];
    const stops = [stop('Lisbon', 0, T0, [located[0].id]), stop('Porto', 1, T0 + 24 * H, [located[1].id])];
    const p = photo({ takenAt: T0 + 12 * H, timeSource: 'exif' });
    const queries = placeQueries([...located, p], stops);
    const r = inferPlaces([...located, p], stops, { queries, guesses: [guessFor(queries[0], 'Porto, Portugal', 0.4, 0.1)] });
    expect(r.looseIds).toEqual([p.id]);
    expect(r.suggestions).toEqual([{ photoId: p.id, stopId: stops[1].id, score: 0.4 }]);
  });
  it('places an untrusted photo only on a confident pick and borrows the stop time', () => {
    const { located, stops } = trip();
    const sure = photo({ takenAt: Date.parse('2026-06-20T10:00:00'), timeSource: 'file' });
    const unsure = photo({ takenAt: T0 + 3 * H, timeSource: 'file' });
    const queries = placeQueries([...located, sure, unsure], stops);
    const r = inferPlaces([...located, sure, unsure], stops, {
      queries,
      guesses: [guessFor(queries[0], 'Sintra, Portugal', 0.9, 0.7), guessFor(queries[1], 'Sintra, Portugal', 0.55, 0.2)],
    });
    expect(r.updated.find((p) => p.id === sure.id)).toMatchObject({ takenAt: stops[1].arrivedAt, timeEstimated: true });
    // A file date is never used to interpolate, even though this one falls inside the trip.
    expect(r.looseIds).toEqual([unsure.id]);
  });
  it('matches an untrusted photo visually across the whole trip', () => {
    const { located, stops } = trip();
    located[0].visualHash = '0f0f0f0f0f0f0f0f';
    const copy = photo({ takenAt: T0 + 30 * 24 * H, timeSource: 'file', visualHash: '0f0f0f0f0f0f0f0f' });
    const r = inferPlaces([...located, copy], stops);
    expect(r.stops[0].photoIds).toContain(copy.id);
    expect(r.updated[0].locationSource).toBe('inferred-visual');
  });
});

describe('rankLabels', () => {
  it('matches a softmax over only the photo’s own labels', () => {
    // The batch encodes four labels; this photo was only asked about labels 3 and 1.
    const logits = [24, 16, 15, 13];
    const r = rankLabels(logits, [3, 1]);
    const p = Math.exp(16) / (Math.exp(16) + Math.exp(13));
    expect(r.candidateIndex).toBe(1);
    expect(r.score).toBeCloseTo(p);
    expect(r.margin).toBeCloseTo(p - (1 - p));
  });
});

describe('inferPlaces with autoPin', () => {
  it('places a trusted photo in a long gap by time instead of leaving it', () => {
    const located = [photo({ lat: 0, lng: 0, timeSource: 'exif' }), photo({ takenAt: T0 + 24 * H, lat: 2, lng: 2, timeSource: 'exif' })];
    const stops = [stop('Lisbon', 0, T0, [located[0].id]), stop('Porto', 2, T0 + 24 * H, [located[1].id])];
    const p = photo({ takenAt: T0 + 12 * H, timeSource: 'exif' });
    const r = inferPlaces([...located, p], stops, { autoPin: true });
    expect(r.looseIds).toEqual([]);
    expect(r.updated[0]).toMatchObject({ id: p.id, locationSource: 'inferred-guess' });
    expect(r.updated[0].lat).toBeCloseTo(1);
  });
  it('attaches an untrusted photo to the model’s unsure pick', () => {
    const { located, stops } = trip();
    const p = photo({ timeSource: 'file' });
    const queries = placeQueries([...located, p], stops);
    const r = inferPlaces([...located, p], stops, { queries, guesses: [guessFor(queries[0], 'Cascais, Portugal', 0.4, 0.1)], autoPin: true });
    expect(r.stops.find((s) => s.place?.city === 'Cascais')!.photoIds).toContain(p.id);
    expect(r.updated[0]).toMatchObject({ locationSource: 'inferred-guess', placementScore: 0.4, timeEstimated: true });
  });
  it('falls back to the stop nearest in time when nothing else is known', () => {
    const { located, stops } = trip();
    const p = photo({ takenAt: T0 + 30 * 24 * H, timeSource: 'file' });
    const r = inferPlaces([...located, p], stops, { autoPin: true });
    expect(r.stops.at(-1)!.photoIds).toContain(p.id);
    expect(r.counts.guess).toBe(1);
  });
});
