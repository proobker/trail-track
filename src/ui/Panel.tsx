import { useState } from 'react';
import { download, fileSafe, toGeoJSON, toGPX, toKML } from '../export/exporters';
import { mapRef } from '../map/MapView';
import { thumbUrl, useJourneyPhotos } from '../model/photos';
import { MODE_META, MODES, type Journey, type Mode, type Photo, type Segment, type Stop } from '../model/types';
import {
  activeJourney,
  attachLoose,
  deleteStop,
  relabelSegment,
  renameJourney,
  reorderStop,
  routeSegments,
  setSegmentMode,
  setTool,
  updateStop,
  useStore,
} from '../store';
import { lineMetres } from '../trail/geo';
import { journeyStats } from '../trail/journey';

const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`);
const time = (t?: number) => (t == null ? '' : new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

const ROUTING_LABEL: Record<Segment['routing'], string> = {
  routed: 'follows roads',
  straight: 'straight line',
  arc: 'flight arc',
  imported: 'imported track',
  manual: 'drawn by hand',
};

function StopRow({ stop, index, count, photos, selected }: { stop: Stop; index: number; count: number; photos: Map<string, Photo>; selected: boolean }) {
  const cover = stop.photoIds.map((id) => photos.get(id)).find((p) => p?.thumbBlob);
  const url = thumbUrl(cover);
  return (
    <div
      className={`group flex items-center gap-3 rounded-xl px-2 py-2 ${selected ? 'bg-emerald-400/10 ring-1 ring-emerald-400/40' : 'hover:bg-white/5'}`}
      onClick={() => {
        useStore.setState({ selectedStopId: stop.id, selectedSegmentId: undefined });
        mapRef.current?.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 900 });
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-900 bg-cover bg-center text-xs font-semibold"
        style={url ? { backgroundImage: `url(${url})` } : undefined}
      >
        {!url && index + 1}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <input
            className="input py-0.5"
            defaultValue={stop.label ?? ''}
            placeholder={`Stop ${index + 1}`}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => updateStop(stop.id, { label: e.target.value.trim() || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <div className="truncate text-sm text-slate-100">{stop.label ?? `Stop ${index + 1}`}</div>
        )}
        <div className="text-xs text-slate-500">
          {time(stop.arrivedAt)}
          {stop.photoIds.length > 0 && ` · ${stop.photoIds.length} photo${stop.photoIds.length === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="flex shrink-0 flex-col opacity-0 group-hover:opacity-100">
        <button className="text-xs text-slate-400 hover:text-white disabled:opacity-20" disabled={index === 0} onClick={(e) => (e.stopPropagation(), reorderStop(index, index - 1))} title="Move up">
          ▲
        </button>
        <button className="text-xs text-slate-400 hover:text-white disabled:opacity-20" disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), reorderStop(index, index + 1))} title="Move down">
          ▼
        </button>
      </div>
      <button className="shrink-0 text-xs text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400" onClick={(e) => (e.stopPropagation(), deleteStop(stop.id))} title="Remove stop">
        ✕
      </button>
    </div>
  );
}

function SegmentRow({ seg, journeyId, selected, routing }: { seg: Segment; journeyId: string; selected: boolean; routing: boolean }) {
  const meta = MODE_META[seg.mode];
  const keepsShape = seg.routing === 'imported' || seg.routing === 'manual';
  const choose = (m: Mode) => (keepsShape ? relabelSegment(seg.id, m) : setSegmentMode(seg.id, m));
  return (
    <div className="flex gap-3 pl-[26px]" onClick={() => useStore.setState({ selectedSegmentId: seg.id, selectedStopId: undefined })}>
      <div className="w-1 shrink-0 rounded-full" style={{ background: meta.color, boxShadow: `0 0 10px ${meta.color}` }} />
      <div className={`my-1 flex-1 rounded-lg px-2 py-1.5 ${selected ? 'bg-white/10' : 'hover:bg-white/5'}`}>
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              title={MODE_META[m].label}
              onClick={(e) => (e.stopPropagation(), choose(m))}
              className={`rounded-md px-1 text-base transition ${seg.mode === m ? 'scale-110 bg-white/15' : 'opacity-40 grayscale hover:opacity-90 hover:grayscale-0'}`}
            >
              {MODE_META[m].icon}
            </button>
          ))}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
          <span>{km(lineMetres(seg.geometry.coordinates as [number, number][]))}</span>
          <span>·</span>
          {routing ? (
            <span className="text-emerald-300">finding route…</span>
          ) : (
            <span className={seg.routing === 'straight' && ['walk', 'bike', 'car', 'bus'].includes(seg.mode) ? 'text-amber-300' : ''}>{ROUTING_LABEL[seg.routing]}</span>
          )}
        </div>
        {selected && (
          <div className="mt-2 flex flex-wrap gap-1">
            {['walk', 'bike', 'car', 'bus'].includes(seg.mode) && (
              <button className="btn-ghost border border-white/10 px-2 py-0.5 text-xs" onClick={(e) => (e.stopPropagation(), routeSegments(journeyId, [seg.id]))}>
                ↻ Follow roads
              </button>
            )}
            <button className="btn-ghost border border-white/10 px-2 py-0.5 text-xs" onClick={(e) => (e.stopPropagation(), setTool('draw'))}>
              ✎ Draw path
            </button>
            {keepsShape && (
              <button className="btn-ghost border border-white/10 px-2 py-0.5 text-xs" onClick={(e) => (e.stopPropagation(), setSegmentMode(seg.id, seg.mode))}>
                Reset path
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RouteTab({ j, photos }: { j: Journey; photos: Map<string, Photo> }) {
  const selectedStopId = useStore((s) => s.selectedStopId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const routing = useStore((s) => s.routing);
  const segFrom = new Map(j.segments.map((s) => [s.fromStopId, s]));
  if (!j.stops.length) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">
        <p className="mb-3">No stops yet.</p>
        <button className="btn-primary" onClick={() => setTool('add')}>
          📍 Click the map to add stops
        </button>
      </div>
    );
  }
  return (
    <div className="p-2">
      {j.stops.map((s, i) => {
        const seg = segFrom.get(s.id);
        return (
          <div key={s.id}>
            <StopRow stop={s} index={i} count={j.stops.length} photos={photos} selected={s.id === selectedStopId} />
            {seg && i < j.stops.length - 1 && <SegmentRow seg={seg} journeyId={j.id} selected={seg.id === selectedSegmentId} routing={routing.has(seg.id)} />}
          </div>
        );
      })}
    </div>
  );
}

function PhotosTab({ j, photos }: { j: Journey; photos: Map<string, Photo> }) {
  const selectedStopId = useStore((s) => s.selectedStopId);
  const stop = j.stops.find((s) => s.id === selectedStopId);
  const loose = (j.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
  const nearestStop = (p: Photo) =>
    j.stops.filter((s) => s.arrivedAt != null).sort((a, b) => Math.abs(a.arrivedAt! - p.takenAt) - Math.abs(b.arrivedAt! - p.takenAt))[0] ?? j.stops[0];

  return (
    <div className="space-y-5 p-4">
      {stop && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-300">{stop.label ?? 'Selected stop'}</h3>
          {stop.photoIds.length === 0 ? (
            <p className="text-xs text-slate-500">No photos at this stop.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {stop.photoIds.map((id) => (
                <Thumb key={id} photo={photos.get(id)} />
              ))}
            </div>
          )}
        </section>
      )}
      <section>
        <h3 className="mb-1 text-sm font-medium text-slate-300">Photos without location ({loose.length})</h3>
        <p className="mb-2 text-xs text-slate-500">They sit along the trail by the time they were taken (dashed on the map). Pin one to place it exactly, or attach it to a stop.</p>
        <div className="space-y-2">
          {loose.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                <Thumb photo={p} />
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate text-slate-200">{p.fileName}</div>
                <div className="text-slate-500">{time(p.takenAt)}</div>
              </div>
              <button className="btn-ghost border border-white/10 px-2 py-0.5 text-xs" onClick={() => setTool('pin', p.id)}>
                📍 Pin
              </button>
              {j.stops.length > 0 && (
                <button className="btn-ghost border border-white/10 px-2 py-0.5 text-xs" title="Attach to the stop closest in time" onClick={() => attachLoose(p.id, nearestStop(p).id)}>
                  Attach
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <button className="btn-ghost w-full border border-white/10" onClick={() => useStore.setState({ wizardOpen: true })}>
        + Add more photos
      </button>
    </div>
  );
}

function Thumb({ photo }: { photo?: Photo }) {
  const url = thumbUrl(photo);
  return url ? (
    <img src={url} alt={photo?.fileName} className="aspect-square h-full w-full rounded-md object-cover" loading="lazy" />
  ) : (
    <div className="flex aspect-square h-full w-full items-center justify-center rounded-md bg-slate-800 text-lg">🖼️</div>
  );
}

function ExportTab({ j }: { j: Journey }) {
  const name = fileSafe(j.title);
  return (
    <div className="space-y-2 p-4">
      <p className="mb-3 text-xs text-slate-400">Open these in Google Earth, Google My Maps, Strava, Garmin or any GIS tool.</p>
      <button className="btn-ghost w-full justify-start border border-white/10" onClick={() => download(`${name}.gpx`, toGPX(j), 'application/gpx+xml')}>
        ⬇ GPX
      </button>
      <button className="btn-ghost w-full justify-start border border-white/10" onClick={() => download(`${name}.kml`, toKML(j), 'application/vnd.google-earth.kml+xml')}>
        ⬇ KML
      </button>
      <button className="btn-ghost w-full justify-start border border-white/10" onClick={() => download(`${name}.geojson`, JSON.stringify(toGeoJSON(j)), 'application/geo+json')}>
        ⬇ GeoJSON
      </button>
    </div>
  );
}

export function Panel() {
  const j = useStore(activeJourney);
  const photos = useJourneyPhotos(j);
  const [tab, setTab] = useState<'route' | 'photos' | 'export'>('route');
  if (!j) return null;
  const st = journeyStats(j);
  const looseCount = j.loosePhotoIds?.length ?? 0;

  return (
    <aside className="glass z-20 flex w-80 shrink-0 flex-col border-y-0 border-r-0">
      <div className="border-b border-white/10 p-4">
        <input
          key={j.id}
          className="font-display w-full bg-transparent text-xl font-semibold text-white outline-none focus:underline"
          defaultValue={j.title}
          onBlur={(e) => e.target.value.trim() && renameJourney(j.id, e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="mt-1 text-xs text-slate-400">
          {st.start ? `${new Date(st.start).toLocaleDateString(undefined, { dateStyle: 'medium' })}${st.end && toDay(st.end) !== toDay(st.start) ? ` – ${new Date(st.end).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}` : 'No dates'}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat value={km(st.totalKm * 1000)} label="distance" />
          <Stat value={String(j.stops.length)} label="stops" />
          <Stat value={String(st.photoCount + looseCount)} label="photos" />
        </div>
        {st.totalKm > 0 && (
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10">
            {[...st.byMode].map(([m, d]) => (
              <div key={m} title={`${MODE_META[m].label}: ${km(d)}`} style={{ width: `${(d / (st.totalKm * 1000)) * 100}%`, background: MODE_META[m].color }} />
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1 border-b border-white/10 px-2 py-1.5">
        {(
          [
            ['route', 'Route'],
            ['photos', `Photos${looseCount ? ` · ${looseCount} unplaced` : ''}`],
            ['export', 'Export'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`btn-ghost flex-1 text-xs ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'route' && <RouteTab j={j} photos={photos} />}
        {tab === 'photos' && <PhotosTab j={j} photos={photos} />}
        {tab === 'export' && <ExportTab j={j} />}
      </div>
    </aside>
  );
}

const toDay = (t: number) => new Date(t).toDateString();

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/5 py-1.5">
      <div className="font-display text-base text-white">{value}</div>
      <div className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  );
}
