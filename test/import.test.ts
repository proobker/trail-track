import { describe, expect, it } from 'vitest';
import { toGPX, toKML } from '../src/export/exporters';
import { parseTrackText, trackToJourney } from '../src/import/tracks';
import { matchImageName, parseSidecar } from '../src/import/takeoutSidecar';
import { dateFromFileName } from '../src/import/fileNameDate';
import { isTextHeavy, type TextLine } from '../src/import/textHeavy';
import { makeLocator, parseTimeline, prepareFixes } from '../src/import/timeline';
import { buildTimeline, sample } from '../src/animate/timeline';
import { arc } from '../src/routing/route';

describe('text-heavy photo filter', () => {
  const line = (text: string, y: number, width = 700, height = 28, confidence = 90): TextLine => ({
    text, confidence, bbox: { x0: 100, y0: y, x1: 100 + width, y1: y + height },
  });
  it('flags document pages and large quote cards', () => {
    const document = Array.from({ length: 8 }, (_, i) => line('This is a paragraph from a scanned document', 80 + i * 55));
    expect(isTextHeavy(document, 1000, 800)).toBe(true);
    expect(isTextHeavy([line('Follow your own path', 200, 800, 110), line('The journey begins today', 350, 800, 110)], 1000, 800)).toBe(true);
  });
  it('keeps journey photos with a sign, incidental lettering, or uncertain OCR', () => {
    expect(isTextHeavy([line('National Park', 200, 300, 25)], 1000, 800)).toBe(false);
    expect(isTextHeavy([line('Trailhead', 200, 250, 25), line('Welcome hikers', 250, 300, 25)], 1000, 800)).toBe(false);
    expect(isTextHeavy(Array.from({ length: 8 }, (_, i) => line('Possible text on a tree', 80 + i * 55, 700, 28, 30)), 1000, 800)).toBe(false);
  });
});

describe('parseSidecar', () => {
  it('reads time, exif location and people', () => {
    const info = parseSidecar({
      title: 'IMG_1.jpg',
      photoTakenTime: { timestamp: '1714550400' },
      geoData: { latitude: 1, longitude: 2 },
      geoDataExif: { latitude: 47.5, longitude: 8.5 },
      people: [{ name: 'Ana' }, { name: ' ' }],
    });
    expect(info).toMatchObject({ title: 'IMG_1.jpg', takenAt: 1714550400000, lat: 47.5, lng: 8.5, people: ['Ana'], locationSource: 'takeout-exif' });
  });
  it('treats 0,0 as no location and falls back to geoData', () => {
    expect(parseSidecar({ photoTakenTime: { timestamp: '1' }, geoDataExif: { latitude: 0, longitude: 0 }, geoData: { latitude: 0, longitude: 0 } })?.lat).toBeUndefined();
    expect(parseSidecar({ photoTakenTime: { timestamp: '1' }, geoDataExif: { latitude: 0, longitude: 0 }, geoData: { latitude: 3, longitude: 4 } })).toMatchObject({ lat: 3, locationSource: 'takeout-edited' });
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

describe('timeline', () => {
  const android = {
    semanticSegments: [
      {
        startTime: '2024-05-12T09:00:00.000+02:00',
        endTime: '2024-05-12T11:00:00.000+02:00',
        startTimeTimezoneUtcOffsetMinutes: 120,
        visit: { topCandidate: { placeLocation: { latLng: '48.8584°, 2.2945°' } } },
      },
      {
        startTime: '2024-05-12T11:00:00.000+02:00',
        endTime: '2024-05-12T12:00:00.000+02:00',
        timelinePath: [
          { point: '48.86°, 2.30°', time: '2024-05-12T11:00:00.000+02:00' },
          { point: '48.88°, 2.34°', time: '2024-05-12T12:00:00.000+02:00' },
        ],
      },
    ],
    rawSignals: [{ position: { LatLng: '1°, 1°', accuracyMeters: 5000, timestamp: '2024-05-12T13:00:00.000+02:00' } }],
  };

  it('reads the Android export and skips vague raw fixes', () => {
    const fixes = prepareFixes(parseTimeline(android));
    expect(fixes).toHaveLength(3);
    expect(fixes[0]).toMatchObject({ lat: 48.8584, lng: 2.2945, off: 120, t: Date.parse('2024-05-12T07:00:00Z'), end: Date.parse('2024-05-12T09:00:00Z') });
  });

  it('reads the iPhone export', () => {
    const fixes = parseTimeline([
      { startTime: '2024-05-12T09:00:00.000+02:00', endTime: '2024-05-12T10:00:00.000+02:00', visit: { topCandidate: { placeLocation: 'geo:48.8584,2.2945' } } },
      { startTime: '2024-05-12T10:00:00.000+02:00', endTime: '2024-05-12T10:30:00.000+02:00', timelinePath: [{ point: 'geo:48.87,2.31', durationMinutesOffsetFromStartTime: '10' }] },
    ]);
    expect(fixes.map((f) => [f.lat, f.off])).toEqual([[48.8584, 120], [48.87, 120]]);
    expect(fixes[1].t).toBe(Date.parse('2024-05-12T08:10:00Z'));
  });

  it('reads older Takeout Records.json and Semantic Location History', () => {
    expect(parseTimeline({ locations: [{ latitudeE7: 488584000, longitudeE7: 22945000, timestamp: '2024-05-12T07:00:00Z' }] })[0]).toMatchObject({ lat: 48.8584, lng: 2.2945 });
    const sem = parseTimeline({
      timelineObjects: [{ placeVisit: { location: { latitudeE7: 488584000, longitudeE7: 22945000 }, duration: { startTimestamp: '2024-05-12T07:00:00Z', endTimestamp: '2024-05-12T09:00:00Z' } } }],
    });
    expect(sem[0]).toMatchObject({ lat: 48.8584, end: Date.parse('2024-05-12T09:00:00Z') });
  });

  it('keeps reported accuracy and time gap for a nearby Timeline fix', () => {
    const t = Date.parse('2024-05-12T07:00:00Z');
    const fixes = parseTimeline({ rawSignals: [{ position: { LatLng: '48.8584°, 2.2945°', accuracyMeters: 18, timestamp: '2024-05-12T07:00:00Z' } }] });
    expect(fixes[0].accuracyM).toBe(18);
    expect(makeLocator(fixes)({ takenAt: t + 5 * 60_000 })).toMatchObject({ method: 'nearest', accuracyM: 18, timeGapMs: 5 * 60_000 });
  });

  it('places photos by visit, then path, then not at all', () => {
    const locate = makeLocator(prepareFixes(parseTimeline(android)));
    expect(locate({ takenAt: Date.parse('2024-05-12T08:00:00Z') })).toEqual({ lat: 48.8584, lng: 2.2945, via: 'visit', method: 'visit', accuracyM: undefined });
    const mid = locate({ takenAt: Date.parse('2024-05-12T09:30:00Z') })!;
    expect(mid.via).toBe('path');
    expect(mid.lat).toBeCloseTo(48.87);
    expect(locate({ takenAt: Date.parse('2024-05-13T09:00:00Z') })).toBeUndefined();
  });

  it('matches clock-only photo times against the local time where they were taken', () => {
    const locate = makeLocator(prepareFixes(parseTimeline(android)));
    // 10:00 on the camera's clock in Paris, whatever zone this machine is in.
    const takenAt = new Date(2024, 4, 12, 10, 0).getTime();
    expect(locate({ takenAt, wallClock: true })?.via).toBe('visit');
  });
});
