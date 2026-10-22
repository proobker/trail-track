import { ArrowLeft, Cloud, FolderOpen, Images, Loader2, MapPinned, PencilLine, Route, Archive, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { googleConfigured, signIn, useAuth } from '../auth/google';
import { materialize, type PhotoCandidate } from '../import/candidate';
import { analyzePhotoScenes, type SceneEmbeddings } from '../import/sceneAnalysis';
import { nameStops, streetClipEngine, type PlaceGuess } from '../import/geolocate';
import { scanUploads } from '../import/exifUpload';
import { pickFromGooglePhotos } from '../import/googlePicker';
import { scanTakeout } from '../import/takeout';
import { findTextHeavy } from '../import/textHeavy';
import { parseTrackText, trackToJourney } from '../import/tracks';
import { savePhotos } from '../model/photos';
import { JUNK_KINDS, KIND_LABEL, photoKind, type PhotoKind } from '../import/photoKind';
import { makeLocator, readTimelineFiles } from '../import/timeline';
import type { PersonFilter, Photo, Segment, Stop } from '../model/types';
import { activeJourney, addPhotosToJourney, createJourney, notify, setTool, useStore } from '../store';
import { clusterPhotos } from '../trail/cluster';
import { localDay } from '../trail/days';
import { candidateStopIds, inferPlaces, placeQueries } from '../trail/inferPlaces';
import { matchUnlocated } from '../trail/matchUnlocated';
import { filterPhotos, hasLocation, peopleIndex } from '../trail/filter';
import { newJourney, reconcileSegments } from '../trail/journey';
import { findOutliers } from '../trail/outliers';
import { DAY_MS, findHome, groupTrips, rangeTitle, TRIP_GAP_DAYS } from '../trail/trips';
import { reverseGeocode } from '../geo/reverse';
import { pickFiles } from './pickFiles';
import { TimelineHelp } from './TimelineHelp';
import { HomePicker } from './HomePicker';
import { usePrefs } from '../map/prefs';

/** Chat images are often real trip photos from friends, so only the clear junk is left out by default. */
const DEFAULT_SKIP: PhotoKind[] = ['screenshot', 'document', 'saved'];

type Source = 'takeout' | 'upload' | 'picker' | 'track' | 'manual';

const SOURCES: { id: Source; icon: LucideIcon; title: string; body: string }[] = [
  { id: 'takeout', icon: Archive, title: 'Google Takeout', body: 'Best for a photo library: includes Google Photos location sidecars and recognised people. Add an original GPX track for a more precise trail.' },
  { id: 'upload', icon: Images, title: 'Upload photos', body: 'Original camera files may contain GPS and reported accuracy. Shared or compressed copies often lose location.' },
  { id: 'picker', icon: Cloud, title: 'Google Photos', body: 'Pick photos directly. Google removes GPS here; use a track or Timeline to place them, or pin them manually.' },
  { id: 'track', icon: Route, title: 'Import a track', body: 'Import a recorded KML, GPX or GeoJSON path for the best route shape. A few photo GPS points cannot resolve trail junctions.' },
  { id: 'manual', icon: PencilLine, title: 'Draw it myself', body: 'Click the map to add stops and choose how you travelled between them.' },
];

const toDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function Wizard() {
  const open = useStore((s) => s.wizardOpen);
  const current = useStore(activeJourney);
  const user = useAuth((s) => s.user);
  const [source, setSource] = useState<Source>();
  const [cands, setCands] = useState<PhotoCandidate[]>();
  const [busy, setBusy] = useState<string>();
  const [title, setTitle] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [person, setPerson] = useState<PersonFilter>({ mode: 'any' });
  const [includeLoose, setIncludeLoose] = useState(true);
  const [analyzeScenes, setAnalyzeScenes] = useState(false);
  const [findPlaces, setFindPlaces] = useState(false);
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [skipKinds, setSkipKinds] = useState<Set<PhotoKind>>(() => new Set(DEFAULT_SKIP));
  const [textScan, setTextScan] = useState<{ key: string; flagged: Set<string>; kept: Set<string> }>();
  /** 0 keeps everything in one journey. */
  const [gapDays, setGapDays] = useState(TRIP_GAP_DAYS);
  /** Groups whose default the user flipped (trips unticked, at-home stretches ticked), keyed by their first photo's id. */
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const [useHome, setUseHome] = useState(true);
  const [homeName, setHomeName] = useState<string>();

  const reset = () => {
    setSource(undefined);
    setCands(undefined);
    setBusy(undefined);
    setTitle('');
    setDateFrom('');
    setDateTo('');
    setPerson({ mode: 'any' });
    setTarget('new');
    setSkipKinds(new Set(DEFAULT_SKIP));
    setTextScan(undefined);
    setAnalyzeScenes(false);
    setGapDays(TRIP_GAP_DAYS);
    setFlipped(new Set());
    setUseHome(true);
  };
  const close = () => {
    reset();
    useStore.setState({ wizardOpen: false });
  };

  const people = useMemo(() => (cands ? peopleIndex(cands.map((c) => c.photo)) : []), [cands]);
  const inRange = useMemo(() => {
    if (!cands) return [];
    const keep = new Set(filterPhotos(cands.map((c) => c.photo), { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, person }).map((p) => p.id));
    return cands.filter((c) => keep.has(c.photo.id)).map((c) => ({ ...c, kind: photoKind(c.photo) }));
  }, [cands, dateFrom, dateTo, person]);
  const kindCounts = useMemo(() => {
    const n = new Map<PhotoKind, number>();
    for (const c of inRange) n.set(c.kind, (n.get(c.kind) ?? 0) + 1);
    return n;
  }, [inRange]);
  const eligible = useMemo(
    () => inRange.filter((c) => !skipKinds.has(c.kind) && (includeLoose || hasLocation(c.photo))),
    [inRange, skipKinds, includeLoose],
  );
  const textScanKey = eligible.map((c) => c.photo.id).join('|');
  const currentTextScan = textScan?.key === textScanKey ? textScan : undefined;
  const matching = useMemo(
    () => eligible.filter((c) => !currentTextScan?.flagged.has(c.photo.id) || currentTextScan.kept.has(c.photo.id)),
    [eligible, currentTextScan],
  );
  const detectedHome = useMemo(() => findHome(matching.map((c) => ({ t: c.photo.takenAt, lat: c.photo.lat, lng: c.photo.lng }))), [matching]);
  const savedHome = usePrefs((s) => s.home);
  const [pickingHome, setPickingHome] = useState(false);
  const home = useMemo(() => (useHome ? (savedHome ? { ...savedHome, days: 0 } : detectedHome) : undefined), [useHome, savedHome, detectedHome]);
  useEffect(() => {
    setHomeName(undefined);
    if (!detectedHome) return;
    let live = true;
    void reverseGeocode(detectedHome.lng, detectedHome.lat).then((p) => live && setHomeName(p?.city ?? p?.name));
    return () => {
      live = false;
    };
  }, [detectedHome?.lat, detectedHome?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const trips = useMemo(
    () =>
      target === 'new' && gapDays > 0
        ? groupTrips(matching, (c) => ({ t: c.photo.takenAt, lat: c.photo.lat, lng: c.photo.lng }), gapDays * DAY_MS, home)
        : [{ items: matching, home: false }],
    [matching, target, gapDays, home],
  );
  const included = (g: { items: typeof matching; home: boolean }) => g.items.length > 0 && g.home === flipped.has(g.items[0].photo.id);
  const chosen = trips.filter(included).map((g) => g.items);
  const tripCount = trips.filter((g) => !g.home).length;
  const chosenCount = chosen.reduce((n, t) => n + t.length, 0);
  const located = chosen.reduce((n, t) => n + t.filter((c) => hasLocation(c.photo)).length, 0);

  if (!open) return null;

  const withBusy = async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const gotCandidates = (list: PhotoCandidate[]) => {
    if (!list.length) throw new Error('No photos found there');
    const times = list.map((c) => c.photo.takenAt).sort((a, b) => a - b);
    setCands(list);
    setTextScan(undefined);
    setDateFrom(toDay(times[0]));
    setDateTo(toDay(times[times.length - 1]));
    if (current) setTarget(list.every((c) => !hasLocation(c.photo)) ? 'current' : 'new');
  };

  const locateWithTimeline = async () => {
    const files = await pickFiles('.json');
    if (!files.length || !cands) return;
    await withBusy('Reading your Timeline…', async () => {
      const locate = makeLocator(await readTimelineFiles(files));
      let found = 0;
      const missing = cands.filter((c) => !hasLocation(c.photo)).length;
      setCands(
        cands.map((c) => {
          const at = hasLocation(c.photo) ? undefined : locate(c.photo);
          if (!at) return c;
          found++;
          return { ...c, photo: { ...c.photo, lat: at.lat, lng: at.lng, locatedBy: 'timeline' as const, locationSource: at.via === 'visit' ? 'timeline-visit' as const : 'timeline-path' as const, locationAccuracyM: at.accuracyM, locationAccuracyLevel: at.accuracyM != null ? 'unspecified' as const : undefined, locationTimeGapMs: at.timeGapMs } };
        }),
      );
      if (found && target === 'current' && current) setTarget('new');
      notify(found ? `Found a place for ${found} of ${missing} photos in your Timeline` : 'None of these photos fall within your Timeline data');
    });
  };

  const choose = async (s: Source) => {
    setSource(s);
    if (s === 'manual') {
      await createJourney(newJourney(title || 'New journey', { autoTitle: !title.trim() }));
      setTool('add');
      notify('Click the map to add stops, or search for a place');
      close();
    }
  };

  const importTracks = async () => {
    const files = await pickFiles('.kml,.gpx,.geojson,.json');
    if (!files.length) return;
    await withBusy('Reading track…', async () => {
      const stops: Stop[] = [];
      const segments: Segment[] = [];
      for (const f of files) {
        const t = trackToJourney(parseTrackText(await f.text(), f.name), f.name);
        stops.push(...t.stops);
        segments.push(...t.segments);
      }
      if (!stops.length) throw new Error('No tracks or places found in that file');
      // Join consecutive files with a routed connector where they don't already meet.
      const { segments: all, needsRouting } = reconcileSegments(stops, segments);
      const name = title || files[0].name.replace(/\.[^.]+$/, '');
      await createJourney(newJourney(name, { autoTitle: !title.trim(), stops, segments: all }), needsRouting);
      notify(`Imported ${segments.length} track${segments.length === 1 ? '' : 's'}`);
      close();
    });
  };

  const create = () =>
    withBusy('Preparing photos…', async () => {
      try {
        const photos = await materialize(chosen.flat(), (d, t) => setBusy(`Preparing photos… ${d} / ${t}`));
        let embeddings: SceneEmbeddings | undefined;
        let sceneAnalysisFailed = false;
        if (analyzeScenes) {
          setBusy('Loading on-device image model…');
          try {
            embeddings = await analyzePhotoScenes(photos, (d, t) => setBusy(`Analyzing scenes on this device… ${d} / ${t}`));
          } catch {
            sceneAnalysisFailed = true;
          }
        }
        await savePhotos(photos);
        const byId = new Map(photos.map((p) => [p.id, p]));
        let glitchCount = 0;
        const placed = { visual: 0, ai: 0, time: 0, guess: 0 };
        const inferred: Photo[] = [];
        let placeModelFailed = false;
        const build = async (group: Photo[]) => {
          let stops = clusterPhotos(group, undefined, embeddings);
          // Photos whose GPS jumps far away and straight back are glitches: place them like photos without GPS.
          const glitches = findOutliers(stops);
          if (glitches.size) {
            const glitchIds = new Set(stops.filter((st) => glitches.has(st.id)).flatMap((st) => st.photoIds));
            glitchCount += glitchIds.size;
            stops = stops.filter((st) => !glitches.has(st.id));
            group = group.map((p) => (glitchIds.has(p.id) ? { ...p, lat: undefined, lng: undefined } : p));
          }
          let queries;
          let guesses: PlaceGuess[] | undefined;
          // Photos a located shot already explains don't need the place model.
          const unmatched = new Set(matchUnlocated(group, stops, embeddings).looseIds);
          const toRank = group.filter((p) => hasLocation(p) || unmatched.has(p.id));
          if (findPlaces && stops.length > 1 && unmatched.size) {
            streetClipEngine.preload?.();
            // Place names are the choices the model picks from; only the ones some photo can use are looked up.
            stops = await nameStops(stops, (d, t) => setBusy(`Looking up place names… ${d} / ${t}`), candidateStopIds(toRank, stops));
            queries = placeQueries(toRank, stops);
            if (queries.length) {
              setBusy('Loading on-device place model…');
              try {
                guesses = await streetClipEngine.rank(queries, (d, t) => setBusy(`Recognising places on this device… ${d} / ${t}`));
              } catch {
                placeModelFailed = true;
              }
            }
          }
          const result = inferPlaces(group, stops, { queries, guesses, embeddings, autoPin: true });
          inferred.push(...result.updated);
          placed.visual += result.counts.visual;
          placed.ai += result.counts.ai;
          placed.time += result.counts.time;
          placed.guess += result.counts.guess;
          return { stops: result.stops, loose: result.looseIds };
        };
        if (target === 'current' && current) {
          const { stops, loose } = await build(photos);
          addPhotosToJourney(stops, loose);
          notify(`Added ${photos.length} photos to ${current.title}`);
        } else {
          let stopCount = 0;
          // Oldest first, so the newest trip ends up on top of the list and open.
          for (const [i, trip] of chosen.entries()) {
            const group = trip.map((c) => byId.get(c.photo.id)!);
            const { stops, loose } = await build(group);
            stopCount += stops.length;
            const { segments, needsRouting } = reconcileSegments(stops, []);
            const many = chosen.length > 1;
            const from = many ? localDay(trip[0].photo.takenAt) : dateFrom;
            const to = many ? localDay(trip[trip.length - 1].photo.takenAt) : dateTo;
            const name = title ? (many ? `${title} (${i + 1})` : title) : rangeTitle(from, to);
            await createJourney(newJourney(name, { autoTitle: !title.trim(), dateFrom: from, dateTo: to, personFilter: person, stops, segments, loosePhotoIds: loose }), needsRouting);
          }
          notify(
            chosen.length > 1
              ? `Built ${chosen.length} journeys, one per trip`
              : stopCount
                ? `Built a trail with ${stopCount} stops`
                : 'No photo had a location. Pin them on the map from the Photos tab.',
          );
        }
        if (glitchCount) {
          setTimeout(() => notify(`${glitchCount} photo${glitchCount === 1 ? '' : 's'} had suspicious GPS and ${glitchCount === 1 ? 'was' : 'were'} placed from the trail instead`), 3800);
        }
        if (inferred.length) await savePhotos(inferred);
        if (sceneAnalysisFailed) setTimeout(() => notify('Image model could not load; places were grouped using GPS, time and image fingerprints'), 3800);
        if (placeModelFailed) setTimeout(() => notify('Place model could not load; photos without GPS were placed by time where possible'), 3800);
        const placedTotal = placed.visual + placed.ai + placed.time + placed.guess;
        if (placedTotal) {
          const parts = [placed.visual && `${placed.visual} by a matching photo`, placed.ai && `${placed.ai} by recognising the place`, placed.time && `${placed.time} by time`, placed.guess && `${placed.guess} as rough guesses`].filter(Boolean);
          setTimeout(() => notify(`Placed ${placedTotal} photo${placedTotal === 1 ? '' : 's'} without GPS (${parts.join(', ')})`), 3800);
        }
        close();
      } finally {
        // The place model is shared by every trip in this import; free it once they are all built.
        void streetClipEngine.release?.();
      }
    });

  const scanForText = () => withBusy('Loading on-device text scanner…', async () => {
    const flagged = await findTextHeavy(
      eligible.map((c) => ({ id: c.photo.id, getBlob: async () => c.getBlob?.() })),
      (done, total) => setBusy(`Checking photos for text… ${done} / ${total}`),
    );
    setTextScan({ key: textScanKey, flagged, kept: new Set() });
    notify(flagged.size ? `Found ${flagged.size} text-heavy photo${flagged.size === 1 ? '' : 's'} to review` : 'No text-heavy photos found');
  });

  const toggle = <T,>(s: Set<T>, v: T) => {
    const next = new Set(s);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="glass-strong pop-in max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-3xl p-5 shadow-2xl sm:p-7">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">{cands ? 'Choose what to map' : 'New journey'}</h2>
            <p className="text-sm text-slate-400">{cands ? `${cands.length} photos found` : 'Where should the trail come from?'}</p>
          </div>
          <button className="icon-btn h-9 w-9" onClick={close} disabled={!!busy} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!cands && (
          <>
            <input className="input mb-4" placeholder="Journey name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  className={`rounded-xl border p-4 text-left transition hover:border-emerald-400/60 hover:bg-white/5 ${source === s.id ? 'border-emerald-400/70 bg-white/5' : 'border-white/10'}`}
                  onClick={() => choose(s.id)}
                  disabled={!!busy}
                >
                  <s.icon size={22} className="mb-2 text-emerald-300" />
                  <div className="font-medium text-white">{s.title}</div>
                  <div className="text-xs leading-relaxed text-slate-400">{s.body}</div>
                </button>
              ))}
            </div>

            {source === 'takeout' && (
              <div className="mt-4 rounded-xl bg-white/5 p-4 text-sm">
                <p className="mb-3 text-slate-300">
                  Export your library at{' '}
                  <a className="text-emerald-300 underline" href="https://takeout.google.com/" target="_blank" rel="noreferrer">
                    takeout.google.com
                  </a>{' '}
                  (select only Google Photos), then add the zip files or the extracted folder. Everything is read on this device; nothing is uploaded.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={!!busy} onClick={async () => {
                    const files = await pickFiles('.zip');
                    if (files.length) await withBusy('Reading Takeout…', async () => gotCandidates(await scanTakeout(files, setBusy)));
                  }}>
                    Choose zip files
                  </button>
                  <button className="btn-ghost border border-white/10" disabled={!!busy} onClick={async () => {
                    const files = await pickFiles('', { directory: true });
                    if (files.length) await withBusy('Reading Takeout…', async () => gotCandidates(await scanTakeout(files, setBusy)));
                  }}>
                    <FolderOpen size={15} /> Choose extracted folder
                  </button>
                </div>
              </div>
            )}
            {source === 'upload' && (
              <div className="mt-4 rounded-xl bg-white/5 p-4 text-sm">
                <p className="mb-3 text-slate-300">Choose original photos. Messaging apps often strip location, so photos sent over chat may need to be pinned by hand.</p>
                <button className="btn-primary" disabled={!!busy} onClick={async () => {
                  const files = await pickFiles('image/*');
                  if (files.length) await withBusy('Reading photo details…', async () => gotCandidates(await scanUploads(files)));
                }}>
                  Choose photos
                </button>
              </div>
            )}
            {source === 'picker' && (
              <div className="mt-4 rounded-xl bg-white/5 p-4 text-sm">
                {!googleConfigured() ? (
                  <p className="text-amber-300">Google sign-in isn't set up for this app yet. Add VITE_GOOGLE_CLIENT_ID to .env (see README).</p>
                ) : (
                  <>
                    <p className="mb-3 text-slate-300">
                      Tip: build the trail from Takeout, uploads or a track first, then add Google Photos to it. They will slot in along the route by the time they were taken.
                    </p>
                    <button className="btn-primary" disabled={!!busy} onClick={() => withBusy('Signing in…', async () => {
                      if (!user) await signIn();
                      gotCandidates(await pickFromGooglePhotos(setBusy));
                    })}>
                      {user ? 'Open Google Photos' : 'Sign in with Google'}
                    </button>
                  </>
                )}
              </div>
            )}
            {source === 'track' && (
              <div className="mt-4 rounded-xl bg-white/5 p-4 text-sm">
                <p className="mb-3 text-slate-300">
                  Several files are joined in the order you pick them. Tip: Google My Maps and Google Earth export KML; Strava and Garmin export GPX.
                </p>
                <button className="btn-primary" disabled={!!busy} onClick={importTracks}>
                  Choose file
                </button>
              </div>
            )}
          </>
        )}

        {cands && (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-medium text-slate-300">Dates</h3>
              <div className="flex items-center gap-2">
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className="text-slate-500">→</span>
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-medium text-slate-300">People</h3>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['any', 'Everyone'],
                    ['none', 'No people (scenery)'],
                    ['person', 'A specific person'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={`btn-ghost border border-white/10 ${person.mode === mode ? 'active' : ''}`}
                    disabled={mode === 'person' && !people.length}
                    onClick={() => setPerson(mode === 'person' ? { mode, name: people[0].name } : { mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {person.mode === 'person' && (
                <select className="input mt-2" value={person.name} onChange={(e) => setPerson({ mode: 'person', name: e.target.value })}>
                  {people.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.count})
                    </option>
                  ))}
                </select>
              )}
              {!people.length && (
                <p className="mt-2 text-xs text-slate-500">
                  Person filters need names from Google Takeout. Name people in Google Photos (Explore → People) before exporting.
                </p>
              )}
            </section>
            {JUNK_KINDS.some((k) => kindCounts.get(k)) && (
              <section>
                <h3 className="mb-2 text-sm font-medium text-slate-300">Leave out</h3>
                <div className="flex flex-wrap gap-2">
                  {JUNK_KINDS.filter((k) => kindCounts.get(k)).map((k) => (
                    <label key={k} className={`btn-ghost cursor-pointer border border-white/10 ${skipKinds.has(k) ? 'active' : ''}`}>
                      <input type="checkbox" className="sr-only" checked={skipKinds.has(k)} onChange={() => setSkipKinds((s) => toggle(s, k))} />
                      {KIND_LABEL[k]} ({kindCounts.get(k)})
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Recognised from file names and the phone folder they came from. Anything missed can be removed later from the Photos tab.</p>
              </section>
            )}
            <section className="rounded-xl bg-white/5 p-4 text-sm">
              <h3 className="mb-1 font-medium text-slate-200">Photos with lots of text</h3>
              <p className="mb-3 text-xs leading-relaxed text-slate-400">Scan the picture itself for text and leave out text-heavy images. A sign or a few words in a journey photo should stay. The scanner runs on this device; first use downloads its English text data.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-ghost border border-white/10" disabled={!!busy || !eligible.length} onClick={scanForText}>
                  {currentTextScan ? 'Scan again' : 'Find text-heavy photos'}
                </button>
                {currentTextScan && <span className="text-xs text-slate-400">{currentTextScan.flagged.size - currentTextScan.kept.size} left out</span>}
                {currentTextScan && <button className="text-xs text-emerald-300 underline" onClick={() => setTextScan(undefined)}>Clear text filter</button>}
              </div>
              {currentTextScan && currentTextScan.flagged.size > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                  {eligible.filter((c) => currentTextScan.flagged.has(c.photo.id)).map((c) => (
                    <li key={c.photo.id}>
                      <label className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-xs text-slate-300">
                        <input type="checkbox" checked={currentTextScan.kept.has(c.photo.id)} onChange={() => setTextScan((scan) => scan && ({ ...scan, kept: toggle(scan.kept, c.photo.id) }))} />
                        <span className="min-w-0 flex-1 truncate">Keep {c.photo.fileName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {current && (
              <section>
                <h3 className="mb-2 text-sm font-medium text-slate-300">Add to</h3>
                <div className="flex gap-2">
                  <button className={`btn-ghost border border-white/10 ${target === 'new' ? 'active' : ''}`} onClick={() => setTarget('new')}>
                    New journey
                  </button>
                  <button className={`btn-ghost border border-white/10 ${target === 'current' ? 'active' : ''}`} onClick={() => setTarget('current')}>
                    “{current.title}”
                  </button>
                </div>
              </section>
            )}
            {inRange.some((c) => !hasLocation(c.photo)) && (
              <section className="rounded-xl bg-white/5 p-4 text-sm">
                <h3 className="mb-1 font-medium text-slate-200">{inRange.filter((c) => !hasLocation(c.photo)).length} photos have no location</h3>
                <p className="mb-3 text-xs leading-relaxed text-slate-400">
                  Your Google Timeline knows where you were when you took them. Export it and add the file here; it is read on this device only.
                </p>
                <button className="btn-ghost border border-white/10" disabled={!!busy} onClick={locateWithTimeline}>
                  <MapPinned size={15} /> Find places with Google Timeline
                </button>
                <TimelineHelp />
              </section>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={includeLoose} onChange={(e) => setIncludeLoose(e.target.checked)} />
              Include photos without location (placed along the trail by time)
            </label>
            {includeLoose && (
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input type="checkbox" className="mt-1" checked={findPlaces} onChange={(e) => setFindPlaces(e.target.checked)} />
                <span>
                  Recognise places for photos without GPS on this device
                  <span className="mt-1 block text-xs text-slate-500">Downloads the StreetCLIP model (about 430 MB) on first use and caches it in this browser. It picks among the places already on your trip; photos stay on this device. File dates from shared or downloaded copies are not trusted for placement. Model licence: CC BY-NC 4.0.</span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input type="checkbox" className="mt-1" checked={analyzeScenes} onChange={(e) => setAnalyzeScenes(e.target.checked)} />
              <span>
                Compare photo scenes on this device to improve stop grouping
                <span className="mt-1 block text-xs text-slate-500">Downloads an approximately 90 MB image model on first use and caches it in this browser. Photos stay on this device. Clear matches to located photos can place otherwise unlocated photos; the model cannot identify a landmark from a picture alone.</span>
              </span>
            </label>
            {target === 'new' && (
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-slate-300">{tripCount > 1 ? `${tripCount} trips` : 'Trips'}</h3>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    New journey after
                    <select className="input w-auto py-1 text-xs" value={gapDays} onChange={(e) => (setGapDays(Number(e.target.value)), setFlipped(new Set()))}>
                      {[1, 2, 3, 7, 14].map((d) => (
                        <option key={d} value={d}>
                          {d}+ day{d === 1 ? '' : 's'} without photos
                        </option>
                      ))}
                      <option value={0}>never (one journey)</option>
                    </select>
                  </label>
                </div>
                {gapDays > 0 && (
                  <div className="mb-2 space-y-2">
                    {(savedHome || detectedHome) && (
                      <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
                        <input type="checkbox" className="mt-0.5" checked={useHome} onChange={(e) => (setUseHome(e.target.checked), setFlipped(new Set()))} />
                        <span>
                          {savedHome
                            ? <>Home is <b className="text-slate-200">{savedHome.name ?? 'the place you set'}</b>.</>
                            : <>Home looks like <b className="text-slate-200">{homeName ?? 'your most photographed area'}</b> ({detectedHome!.days} days of photos).</>}
                          {' '}Trips are the times you were away; everyday photos at home are left out unless you tick them.
                        </span>
                      </label>
                    )}
                    {pickingHome ? (
                      <HomePicker onDone={() => (setPickingHome(false), setUseHome(true), setFlipped(new Set()))} />
                    ) : (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <button className="text-emerald-300 hover:underline" onClick={() => setPickingHome(true)}>
                          {savedHome || detectedHome ? 'Change home' : 'Set your home to split trips'}
                        </button>
                        {savedHome && (
                          <button className="text-slate-400 hover:underline" onClick={() => (usePrefs.setState({ home: undefined }), setFlipped(new Set()))}>
                            {detectedHome ? 'Detect from photos instead' : 'Clear home'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {trips.length > 1 ? (
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-white/[0.03] p-1.5">
                    {trips.map((g) => {
                      const id = g.items[0].photo.id;
                      const from = localDay(g.items[0].photo.takenAt);
                      const to = localDay(g.items[g.items.length - 1].photo.takenAt);
                      return (
                        <li key={id}>
                          <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5 ${g.home ? 'text-slate-500' : 'text-slate-200'}`}>
                            <input type="checkbox" checked={included(g)} onChange={() => setFlipped((s) => toggle(s, id))} />
                            <span className="flex-1">
                              {g.home && 'At home · '}
                              {rangeTitle(from, to)}
                            </span>
                            <span className="text-xs text-slate-500 tabular-nums">{g.items.length} photos</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">All photos are close together in time, so they make one journey.</p>
                )}
              </section>
            )}
            {target === 'new' && <input className="input" placeholder="Name (optional, uses visited locations)" value={title} onChange={(e) => setTitle(e.target.value)} />}

            <div className="flex items-center justify-between rounded-xl bg-white/5 p-4">
              <div className="text-sm">
                <div className="font-display text-2xl text-white">{chosenCount}</div>
                <div className="text-slate-400">
                  photos · <span className="text-emerald-300">{located} with location</span> · {chosenCount - located} without
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={!!busy} onClick={reset}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button className="btn-primary" disabled={!!busy || !chosenCount} onClick={create}>
                  {target === 'current' ? 'Add photos' : chosen.length > 1 ? `Build ${chosen.length} journeys` : 'Build trail'} →
                </button>
              </div>
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-4 flex items-center gap-3 text-sm text-emerald-300">
            <Loader2 size={16} className="animate-spin" />
            {busy}
          </div>
        )}
      </div>
    </div>
  );
}
