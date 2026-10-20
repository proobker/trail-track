import { describe, expect, it } from 'vitest';
import { History } from '../src/model/history';
import type { Journey, Photo, Stop } from '../src/model/types';
import { decodeTerrarium, samplesAlong, summarise, tileXY } from '../src/stats/elevation';
import { groupByDay } from '../src/trail/days';
import { mergeWithNext, splitStop } from '../src/trail/edit';
import { reconcileSegments } from '../src/trail/journey';
import { findOutliers } from '../src/trail/outliers';

const H = 3_600_000;
const T0 = new Date(2026, 5, 12, 9, 0).getTime();
let n = 0;
const stop = (p: Partial<Stop>): Stop => ({ id: `s${n++}`, lat: 0, lng: 0, photoIds: [], origin: 'photo', ...p });
const journey = (stops: Stop[]): Journey => ({ id: 'j', title: 't', personFilter: { mode: 'any' }, stops, segments: reconcileSegments(stops, []).segments, updatedAt: 0 });

describe('groupByDay', () => {
  it('groups consecutive stops by local day and numbers the days', () => {
    const g = groupByDay(
      journey([
        stop({ arrivedAt: T0, photoIds: ['a'] }),
        stop({ lat: 0.01, arrivedAt: T0 + 2 * H }),
        stop({ lat: 0.02 }), // undated: joins the previous day
        stop({ lat: 0.03, arrivedAt: T0 + 48 * H, photoIds: ['b', 'c'] }),
      ]),
    );
    expect(g.map((d) => [d.date, d.dayNumber, d.stops.length, d.photoCount])).toEqual([
      ['2026-06-12', 1, 3, 1],
      ['2026-06-14', 3, 1, 2],
    ]);
    expect(g[0].metres).toBeGreaterThan(3000);
    expect(g[0].spanMs).toBe(2 * H);
  });
  it('puts leading undated stops in an undated group', () => {
    const g = groupByDay(journey([stop({}), stop({ arrivedAt: T0 })]));
    expect(g[0].date).toBeUndefined();
    expect(g[1].dayNumber).toBe(1);
  });
});

describe('findOutliers', () => {
  it('flags a point that jumps away and straight back', () => {
    const glitch = stop({ lat: 5, lng: 5, arrivedAt: T0 + 10 * 60_000 });
    const out = findOutliers([stop({ lat: 38.7, lng: -9.1, arrivedAt: T0 }), glitch, stop({ lat: 38.701, lng: -9.1, arrivedAt: T0 + 20 * 60_000 })]);
    expect([...out]).toEqual([glitch.id]);
  });
  it('does not flag a real flight', () => {
    const out = findOutliers([
      stop({ lat: 38.7, lng: -9.1, arrivedAt: T0 }),
      stop({ lat: 40.4, lng: -3.7, arrivedAt: T0 + 1.5 * H }),
      stop({ lat: 40.41, lng: -3.7, arrivedAt: T0 + 2 * H }),
    ]);
    expect(out.size).toBe(0);
  });
});

describe('merge and split', () => {
  const photos = new Map<string, Photo>(
    [
      ['p1', T0, 10, 10],
      ['p2', T0 + 60_000, 10, 10],
      ['p3', T0 + 3 * H, 20, 20],
    ].map(([id, t, lat, lng]) => [id as string, { id: id as string, source: 'upload', takenAt: t as number, lat: lat as number, lng: lng as number, people: [], fileName: '' }]),
  );
  it('merges a stop into the next', () => {
    const s = [stop({ photoIds: ['p1'], note: 'a' }), stop({ photoIds: ['p2'], note: 'b', label: 'B' }), stop({})];
    const m = mergeWithNext(s, s[0].id);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ id: s[0].id, photoIds: ['p1', 'p2'], note: 'a\n\nb', label: 'B' });
  });
  it('splits at the largest time gap and repositions both halves', () => {
    const s = [stop({ photoIds: ['p3', 'p1', 'p2'], lat: 15, lng: 15, arrivedAt: T0 })];
    const out = splitStop(s, s[0].id, photos);
    expect(out.map((x) => x.photoIds)).toEqual([['p1', 'p2'], ['p3']]);
    expect(out[0]).toMatchObject({ id: s[0].id, lat: 10, lng: 10 });
    expect(out[1]).toMatchObject({ lat: 20, lng: 20, arrivedAt: T0 + 3 * H });
  });
});

describe('History', () => {
  it('undoes, redoes and caps its size', () => {
    const h = new History<number>(3);
    for (const v of [1, 2, 3, 4]) h.push('d', v);
    expect(h.size('d')).toBe(3);
    expect(h.undo('d', 5)).toBe(4);
    expect(h.redo('d', 4)).toBe(5);
    expect(h.canRedo('d')).toBe(false);
    h.undo('d', 5);
    h.push('d', 9); // a new change clears redo
    expect(h.canRedo('d')).toBe(false);
  });
});

describe('elevation helpers', () => {
  it('decodes terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(131, 232, 128)).toBeCloseTo(1000.5);
  });
  it('computes tile coordinates', () => {
    const [x, y] = tileXY(0, 0, 1);
    expect([x, y]).toEqual([1, 1]);
  });
  it('samples evenly and summarises ascent ignoring noise', () => {
    const pts = samplesAlong(
      [
        [0, 0],
        [0, 0.01],
        [0, 0.02],
      ],
      5,
    );
    expect(pts).toHaveLength(5);
    expect(pts[2].coord[1]).toBeCloseTo(0.01);
    const p = summarise([0, 1, 2, 50, 49, 100, 20].map((ele, i) => ({ at: i, ele })));
    expect(p.ascent).toBe(100);
    expect(p.descent).toBe(80);
  });
});
