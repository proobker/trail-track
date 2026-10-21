import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '../src/model/types';
import { newJourney } from '../src/trail/journey';
import { findNearbyTrails, parseTrailCandidates, trailSearchArea } from '../src/trail/namedTrails';

afterEach(() => vi.unstubAllGlobals());

const journey = (west = 85.32, east = 85.325): Journey => {
  const j = newJourney('Walk');
  j.stops = [
    { id: 'a', lat: 27.71, lng: west, photoIds: [], origin: 'photo' },
    { id: 'b', lat: 27.71, lng: east, photoIds: [], origin: 'photo' },
  ];
  j.segments = [{ id: 'leg', fromStopId: 'a', toStopId: 'b', mode: 'walk', geometry: { type: 'LineString', coordinates: [[west, 27.71], [east, 27.71]] }, routing: 'straight' }];
  return j;
};

describe('named trail search', () => {
  it('bounds the query around walking stops and refuses a large journey', () => {
    const area = trailSearchArea(journey());
    expect(area.bounds[0]).toBeLessThan(27.71);
    expect(area.bounds[1]).toBeLessThan(85.32);
    expect(area.bounds[3]).toBeGreaterThan(85.325);
    expect(() => trailSearchArea(journey(85.32, 86))).toThrow(/large area/);
  });

  it('ranks routes near both stops above a nearby one-stop way', () => {
    const stops: [number, number][] = [[85.32, 27.71], [85.325, 27.71]];
    const found = parseTrailCandidates([
      { type: 'way', id: 1, tags: { name: 'Short Path' }, geometry: [{ lon: 85.32, lat: 27.71 }, { lon: 85.321, lat: 27.71 }] },
      { type: 'relation', id: 2, tags: { name: 'Ridge Trail', route: 'hiking' }, members: [{ type: 'way', geometry: [{ lon: 85.32, lat: 27.71 }, { lon: 85.325, lat: 27.71 }] }] },
      { type: 'way', id: 3, tags: { name: 'Distant Path' }, geometry: [{ lon: 86, lat: 27.71 }, { lon: 86.01, lat: 27.71 }] },
      { type: 'way', id: 4, tags: { name: 'Private Path', access: 'private' }, geometry: [{ lon: 85.32, lat: 27.71 }, { lon: 85.325, lat: 27.71 }] },
    ], stops);
    expect(found.map((x) => [x.name, x.nearStops])).toEqual([['Ridge Trail', 2], ['Short Path', 1]]);
    expect(found[0].lines[0]).toEqual(stops);
  });

  it('requests a bounded, user-initiated Overpass search', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [
      { type: 'way', id: 5, tags: { name: 'Forest Walk' }, geometry: [{ lon: 85.32, lat: 27.71 }, { lon: 85.325, lat: 27.71 }] },
    ] }) });
    vi.stubGlobal('fetch', fetch);
    expect((await findNearbyTrails(journey())).map((candidate) => candidate.name)).toEqual(['Forest Walk']);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(options.method).toBe('POST');
    expect(options.body.get('data')).toMatch(/out geom\(27\./);
  });
});
