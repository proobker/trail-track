import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '../src/model/types';
import { newJourney } from '../src/trail/journey';
import { findNearbyTrails, parseTrailCandidates, parseUsgsCandidates, trailSearchArea } from '../src/trail/namedTrails';

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

  it('uses shaped route points when searching and ranking', () => {
    const j = journey();
    j.segments[0].geometry.coordinates = [[85.32, 27.71], [85.3225, 27.713], [85.325, 27.71]];
    const area = trailSearchArea(j);
    expect(area.bounds[2]).toBeGreaterThan(27.713);
    expect(area.stops).toContainEqual([85.3225, 27.713]);
  });

  it('parses nearby USGS trail geometry as supplementary candidates', () => {
    const found = parseUsgsCandidates([
      { type: 'Feature', properties: { objectid: 42, name: 'Ridge Path', trailnumber: '7' }, geometry: { type: 'MultiLineString', coordinates: [[[-105, 40], [-104.999, 40]]] } },
      { type: 'Feature', properties: { objectid: 43, name: 'Far Away' }, geometry: { type: 'LineString', coordinates: [[-110, 40], [-109, 40]] } },
    ], [[-105, 40]]);
    expect(found).toMatchObject([{ source: 'usgs', type: 'feature', id: 42, name: 'Ridge Path', ref: '7', nearStops: 1 }]);
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

  it('shows USGS candidates when Overpass is unavailable in a US search', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => url.includes('overpass')
      ? Promise.reject(new Error('Overpass unavailable'))
      : Promise.resolve({ ok: true, json: async () => ({ features: [{ type: 'Feature', properties: { objectid: 42, name: 'Ridge Path', hikerpedestrian: 'Y', trailtype: 'Terra Trail' }, geometry: { type: 'LineString', coordinates: [[-105, 40], [-104.995, 40]] } }] }) }));
    vi.stubGlobal('fetch', fetch);
    const j = journey(-105, -104.995);
    j.stops.forEach((s) => { s.lat = 40; });
    j.segments[0].geometry.coordinates = [[-105, 40], [-104.995, 40]];
    expect((await findNearbyTrails(j)).map((c) => c.name)).toEqual(['Ridge Path']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
