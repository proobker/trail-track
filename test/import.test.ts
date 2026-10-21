import { describe, expect, it } from 'vitest';
import { toGPX, toKML } from '../src/export/exporters';
import { parseTrackText, trackToJourney } from '../src/import/tracks';
import { matchImageName, parseSidecar } from '../src/import/takeoutSidecar';
import { dateFromFileName } from '../src/import/fileNameDate';
import { buildTimeline, sample } from '../src/animate/timeline';
import { arc } from '../src/routing/route';

describe('parseSidecar', () => {
  it('reads time, exif location and people', () => {
    const info = parseSidecar({
      title: 'IMG_1.jpg',
      photoTakenTime: { timestamp: '1714550400' },
      geoData: { latitude: 1, longitude: 2 },
      geoDataExif: { latitude: 47.5, longitude: 8.5 },
      people: [{ name: 'Ana' }, { name: ' ' }],
    });
    expect(info).toEqual({ title: 'IMG_1.jpg', takenAt: 1714550400000, lat: 47.5, lng: 8.5, people: ['Ana'] });
  });
  it('treats 0,0 as no location and falls back to geoData', () => {
    expect(parseSidecar({ photoTakenTime: { timestamp: '1' }, geoDataExif: { latitude: 0, longitude: 0 }, geoData: { latitude: 0, longitude: 0 } })?.lat).toBeUndefined();
    expect(parseSidecar({ photoTakenTime: { timestamp: '1' }, geoDataExif: { latitude: 0, longitude: 0 }, geoData: { latitude: 3, longitude: 4 } })?.lat).toBe(3);
  });
  it('ignores album metadata', () => {
    expect(parseSidecar({ title: 'Trip album', description: '' })).toBeUndefined();
  });
});

describe('dateFromFileName', () => {
  const local = (...a: [number, number, number, number, number, number]) => new Date(a[0], a[1] - 1, a[2], a[3], a[4], a[5]).getTime();
  it('reads phone and camera names with a time', () => {
    expect(dateFromFileName('PXL_20240512_093015123.jpg')).toBe(local(2024, 5, 12, 9, 30, 15));
    expect(dateFromFileName('IMG_20240512_093015.jpg')).toBe(local(2024, 5, 12, 9, 30, 15));
    expect(dateFromFileName('20240512_093015.heic')).toBe(local(2024, 5, 12, 9, 30, 15));
    expect(dateFromFileName('Screenshot_2024-05-12-09-30-15-123_com.app.png')).toBe(local(2024, 5, 12, 9, 30, 15));
    expect(dateFromFileName('Photo 2024-05-12 09.30.15.jpg')).toBe(local(2024, 5, 12, 9, 30, 15));
  });
  it('places date-only names (WhatsApp) at noon', () => {
    expect(dateFromFileName('IMG-20240512-WA0003.jpg')).toBe(local(2024, 5, 12, 12, 0, 0));
  });
  it('reads epoch milliseconds', () => {
    expect(dateFromFileName('FB_IMG_1715506215000.jpg')).toBe(1715506215000);
  });
  it('rejects names without a plausible date', () => {
    expect(dateFromFileName('IMG_1234.jpg')).toBeUndefined();
    expect(dateFromFileName('DSC_20240231_120000.jpg')).toBeUndefined();
    expect(dateFromFileName('scan_12345678.jpg')).toBeUndefined();
    expect(dateFromFileName('holiday.jpg')).toBeUndefined();
  });
});

describe('matchImageName', () => {
  const files = new Set(['IMG_1.jpg', 'IMG_2(1).jpg', 'PXL_20260501_101010123.MP.jpg', 'a'.repeat(47) + '.jpg']);
  it('matches classic sidecars', () => expect(matchImageName('IMG_1.jpg.json', 'IMG_1.jpg', files)).toBe('IMG_1.jpg'));
  it('matches supplemental-metadata sidecars, even truncated', () => {
    expect(matchImageName('PXL_20260501_101010123.MP.jpg.supplemental-metadata.json', undefined, files)).toBe('PXL_20260501_101010123.MP.jpg');
    expect(matchImageName('PXL_20260501_101010123.MP.jpg.supplemen.json', undefined, files)).toBe('PXL_20260501_101010123.MP.jpg');
  });
  it('matches duplicate numbering', () => expect(matchImageName('IMG_2.jpg(1).json', 'IMG_2.jpg', files)).toBe('IMG_2(1).jpg'));
  it('matches truncated long names', () => expect(matchImageName('x.json', 'a'.repeat(60) + '.jpg', files)).toBe('a'.repeat(47) + '.jpg'));
});

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="46.0" lon="7.0"><name>Hut</name></wpt>
  <trk><name>Morning hike</name><type>hiking</type><trkseg>
    <trkpt lat="46.0" lon="7.0"><time>2026-05-01T08:00:00Z</time></trkpt>
    <trkpt lat="46.01" lon="7.01"><time>2026-05-01T09:00:00Z</time></trkpt>
    <trkpt lat="46.02" lon="7.02"><time>2026-05-01T10:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe('tracks', () => {
  it('imports a GPX track as one segment with timed stops and waypoint labels', () => {
    const t = trackToJourney(parseTrackText(GPX, 'hike.gpx'), 'hike');
    expect(t.stops).toHaveLength(2);
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].mode).toBe('walk');
    expect(t.segments[0].routing).toBe('imported');
    expect(t.stops[0].label).toBe('Hut');
    expect(t.stops[1].arrivedAt).toBe(Date.parse('2026-05-01T10:00:00Z'));
  });
  it('turns KML placemarks into stops when there are no lines', () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>A</name><Point><coordinates>2.29,48.85</coordinates></Point></Placemark>
      <Placemark><name>B</name><Point><coordinates>2.33,48.86</coordinates></Point></Placemark>
    </Document></kml>`;
    const t = trackToJourney(parseTrackText(kml, 'places.kml'), 'p');
    expect(t.stops.map((s) => s.label)).toEqual(['A', 'B']);
    expect(t.segments).toHaveLength(0);
  });
  it('round-trips through GPX and KML export', () => {
    const t = trackToJourney(parseTrackText(GPX, 'hike.gpx'), 'hike');
    const j = { ...t, id: 'j', title: 'Hike & <fun>', personFilter: { mode: 'any' as const }, updatedAt: 0 };
    for (const [text, name] of [
      [toGPX(j), 'out.gpx'],
      [toKML(j), 'out.kml'],
    ]) {
      const back = trackToJourney(parseTrackText(text, name), 'back');
      expect(back.segments).toHaveLength(1);
      expect(back.segments[0].geometry.coordinates).toHaveLength(3);
      expect(back.segments[0].mode).toBe('walk');
    }
  });
});

describe('arc', () => {
  it('stays one continuous line across the antimeridian', () => {
    const line = arc([139.7, 35.7], [-122.4, 37.8]);
    for (let i = 1; i < line.coordinates.length; i++) {
      expect(Math.abs(line.coordinates[i][0] - line.coordinates[i - 1][0])).toBeLessThan(20);
    }
  });
});

describe('timeline', () => {
  it('draws nothing at the start and everything at the end', () => {
    const t = trackToJourney(parseTrackText(GPX, 'hike.gpx'), 'hike');
    const j = { ...t, id: 'j', title: 'x', personFilter: { mode: 'any' as const }, updatedAt: 0 };
    const tl = buildTimeline(j);
    expect(sample(tl, 0).drawn.features).toHaveLength(0);
    const mid = sample(tl, 0.5);
    expect(mid.head).toBeDefined();
    const end = sample(tl, 1);
    expect(end.drawn.features[0].geometry.coordinates).toHaveLength(3);
    expect(end.reachedStop).toBe(1);
  });
});
