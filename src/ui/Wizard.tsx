import { ArrowLeft, Cloud, FolderOpen, Images, Loader2, PencilLine, Route, Archive, X, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { googleConfigured, signIn, useAuth } from '../auth/google';
import { materialize, type PhotoCandidate } from '../import/candidate';
import { scanUploads } from '../import/exifUpload';
import { pickFromGooglePhotos } from '../import/googlePicker';
import { scanTakeout } from '../import/takeout';
import { parseTrackText, trackToJourney } from '../import/tracks';
import { savePhotos } from '../model/photos';
import { JUNK_KINDS, KIND_LABEL, photoKind, type PhotoKind } from '../import/photoKind';
import type { PersonFilter, Photo, Segment, Stop } from '../model/types';
import { activeJourney, addPhotosToJourney, createJourney, notify, setTool, useStore } from '../store';
import { clusterPhotos } from '../trail/cluster';
import { localDay } from '../trail/days';
import { filterPhotos, hasLocation, peopleIndex } from '../trail/filter';
import { newJourney, reconcileSegments } from '../trail/journey';
import { findOutliers } from '../trail/outliers';
import { DAY_MS, rangeTitle, splitIntoTrips, TRIP_GAP_DAYS } from '../trail/trips';

/** Chat images are often real trip photos from friends, so only the clear junk is left out by default. */
const DEFAULT_SKIP: PhotoKind[] = ['screenshot', 'document', 'saved'];

type Source = 'takeout' | 'upload' | 'picker' | 'track' | 'manual';

const SOURCES: { id: Source; icon: LucideIcon; title: string; body: string }[] = [
  { id: 'takeout', icon: Archive, title: 'Google Takeout', body: 'Your Google Photos export. Brings location and the people Google recognised, so you can filter by person.' },
  { id: 'upload', icon: Images, title: 'Upload photos', body: 'Photos from your phone or camera. Location is read from each photo.' },
  { id: 'picker', icon: Cloud, title: 'Google Photos', body: 'Pick photos directly. Google removes location, so they are placed on the trail by time.' },
  { id: 'track', icon: Route, title: 'Import a track', body: 'A KML, GPX or GeoJSON file from Google Maps, Strava, Garmin and others.' },
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
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [skipKinds, setSkipKinds] = useState<Set<PhotoKind>>(() => new Set(DEFAULT_SKIP));
  /** 0 keeps everything in one journey. */
  const [gapDays, setGapDays] = useState(TRIP_GAP_DAYS);
  /** Trips the user unticked, keyed by their first photo's id. */
  const [skipTrips, setSkipTrips] = useState<Set<string>>(() => new Set());

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
    setGapDays(TRIP_GAP_DAYS);
    setSkipTrips(new Set());
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
  const matching = useMemo(
    () => inRange.filter((c) => !skipKinds.has(c.kind) && (includeLoose || hasLocation(c.photo))),
    [inRange, skipKinds, includeLoose],
  );
  const trips = useMemo(
    () => (target === 'new' && gapDays > 0 ? splitIntoTrips(matching, (c) => c.photo.takenAt, gapDays * DAY_MS) : [matching]),
    [matching, target, gapDays],
  );
  const chosen = trips.filter((t) => t.length && !skipTrips.has(t[0].photo.id));
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
    setDateFrom(toDay(times[0]));
    setDateTo(toDay(times[times.length - 1]));
    if (current) setTarget(list.every((c) => !hasLocation(c.photo)) ? 'current' : 'new');
  };

  const pickFiles = (accept: string, opts: { multiple?: boolean; directory?: boolean } = {}) =>
    new Promise<File[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = opts.multiple ?? true;
      if (opts.directory) input.webkitdirectory = true;
      input.onchange = () => resolve([...(input.files ?? [])]);
      input.click();
    });

  const choose = async (s: Source) => {
    setSource(s);
    if (s === 'manual') {
      await createJourney(newJourney(title || 'New journey'));
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
      await createJourney(newJourney(name, { stops, segments: all }), needsRouting);
      notify(`Imported ${segments.length} track${segments.length === 1 ? '' : 's'}`);
      close();
    });
  };

  const create = () =>
    withBusy('Preparing photos…', async () => {
      const photos = await materialize(chosen.flat(), (d, t) => setBusy(`Preparing photos… ${d} / ${t}`));
      await savePhotos(photos);
      const byId = new Map(photos.map((p) => [p.id, p]));
      let glitchCount = 0;
      const build = (group: Photo[]) => {
        let stops = clusterPhotos(group);
        const loose = group.filter((p) => !hasLocation(p)).map((p) => p.id);
        // Photos whose GPS jumps far away and straight back are glitches: leave them unplaced.
        const glitches = findOutliers(stops);
        if (glitches.size) {
          const moved = stops.filter((st) => glitches.has(st.id)).flatMap((st) => st.photoIds);
          loose.push(...moved);
          glitchCount += moved.length;
          stops = stops.filter((st) => !glitches.has(st.id));
        }
        return { stops, loose };
      };
      if (target === 'current' && current) {
        const { stops, loose } = build(photos);
        addPhotosToJourney(stops, loose);
        notify(`Added ${photos.length} photos to ${current.title}`);
      } else {
        let stopCount = 0;
        // Oldest first, so the newest trip ends up on top of the list and open.
        for (const [i, trip] of chosen.entries()) {
          const group = trip.map((c) => byId.get(c.photo.id)!);
          const { stops, loose } = build(group);
          stopCount += stops.length;
          const { segments, needsRouting } = reconcileSegments(stops, []);
          const many = chosen.length > 1;
          const from = many ? localDay(trip[0].photo.takenAt) : dateFrom;
          const to = many ? localDay(trip[trip.length - 1].photo.takenAt) : dateTo;
          const name = title ? (many ? `${title} (${i + 1})` : title) : rangeTitle(from, to);
          await createJourney(newJourney(name, { dateFrom: from, dateTo: to, personFilter: person, stops, segments, loosePhotoIds: loose }), needsRouting);
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
        setTimeout(() => notify(`${glitchCount} photo${glitchCount === 1 ? '' : 's'} had suspicious GPS and ${glitchCount === 1 ? 'was' : 'were'} moved to “needs a place”`), 3800);
      }
      close();
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
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={includeLoose} onChange={(e) => setIncludeLoose(e.target.checked)} />
              Include photos without location (placed along the trail by time)
            </label>
            {target === 'new' && (
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-slate-300">{trips.length > 1 ? `${trips.length} trips` : 'Trips'}</h3>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    New journey after
                    <select className="input w-auto py-1 text-xs" value={gapDays} onChange={(e) => (setGapDays(Number(e.target.value)), setSkipTrips(new Set()))}>
                      {[1, 2, 3, 7, 14].map((d) => (
                        <option key={d} value={d}>
                          {d}+ day{d === 1 ? '' : 's'} without photos
                        </option>
                      ))}
                      <option value={0}>never (one journey)</option>
                    </select>
                  </label>
                </div>
                {trips.length > 1 ? (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-white/[0.03] p-1.5">
                    {trips.map((t) => {
                      const id = t[0].photo.id;
                      const from = localDay(t[0].photo.takenAt);
                      const to = localDay(t[t.length - 1].photo.takenAt);
                      return (
                        <li key={id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5">
                            <input type="checkbox" checked={!skipTrips.has(id)} onChange={() => setSkipTrips((s) => toggle(s, id))} />
                            <span className="flex-1">{rangeTitle(from, to)}</span>
                            <span className="text-xs text-slate-500 tabular-nums">{t.length} photos</span>
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
            {target === 'new' && <input className="input" placeholder={chosen.length > 1 ? 'Name prefix (optional, default is the dates)' : 'Journey name (optional)'} value={title} onChange={(e) => setTitle(e.target.value)} />}

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
