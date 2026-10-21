import { BarChart3, ChevronRight, Globe2, Images, Route, Share2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { flag } from '../geo/reverse';
import { usePrefs } from '../map/prefs';
import { useJourneyPhotos } from '../model/photos';
import { MODE_META, STACK_ORDER, type Journey } from '../model/types';
import { activeJourney, renameJourney, selectJourney, useStore } from '../store';
import { groupByDay } from '../trail/days';
import { journeyStats } from '../trail/journey';
import { formatKm } from './ModeChip';
import { PhotosTab } from './panel/PhotosTab';
import { RouteTab } from './panel/RouteTab';
import { ShareTab } from './panel/ShareTab';
import { StatsTab } from './panel/StatsTab';
import { useIsMobile } from './useMedia';

type Tab = 'route' | 'photos' | 'stats' | 'share';

function Stat({ value, label }: { value: string; label: string }) {
  // Show units like "km" smaller so the number gets the room.
  const [, num, unit] = value.match(/^(.+?)\s(km|m)$/) ?? [, value, ''];
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.04] px-1.5 py-2 text-center">
      <div className="font-display truncate text-[17px] leading-tight text-white tabular-nums">
        {num}
        {unit && <span className="ml-0.5 text-[11px] text-slate-400">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] tracking-wider text-slate-500 uppercase">{label}</div>
    </div>
  );
}

function dateRange(start?: number, end?: number) {
  if (!start) return 'No dates yet';
  const a = new Date(start);
  const b = end ? new Date(end) : a;
  const same = a.toDateString() === b.toDateString();
  return same ? a.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function JourneyPanel({ j }: { j: Journey }) {
  const photos = useJourneyPhotos(j);
  const [tab, setTab] = useState<Tab>(!j.stops.length && j.loosePhotoIds?.length ? 'photos' : 'route');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const st = journeyStats(j);
  const days = groupByDay(j).filter((d) => d.date).length;
  const looseCount = j.loosePhotoIds?.length ?? 0;
  const tabs: [Tab, string, ReactNode, number?][] = [
    ['route', 'Route', <Route size={15} />],
    ['photos', 'Photos', <Images size={15} />, looseCount || undefined],
    ['stats', 'Stats', <BarChart3 size={15} />],
    ['share', 'Share', <Share2 size={15} />],
  ];
  const modes = STACK_ORDER.filter((m) => st.byMode.get(m));

  return (
    <>
      <div className="px-4 pt-3 pb-3">
        <input
          key={j.id}
          aria-label="Journey name"
          className="font-display -mx-1 w-full rounded-md bg-transparent px-1 text-xl font-semibold text-white outline-none hover:bg-white/5 focus:bg-white/5"
          value={nameDraft ?? j.title}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onBlur={() => {
            if (nameDraft?.trim() && nameDraft.trim() !== j.title) renameJourney(j.id, nameDraft.trim());
            setNameDraft(null);
          }}
        />
        <div className="mt-0.5 text-xs text-slate-400">{dateRange(st.start, st.end)}</div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Stat value={j.segments.length ? formatKm(st.totalKm * 1000) : '—'} label="distance" />
          <Stat value={String(days || '—')} label={days === 1 ? 'day' : 'days'} />
          <Stat value={String(j.stops.length)} label="stops" />
          <Stat value={String(st.photoCount + looseCount)} label="photos" />
        </div>
        {modes.length > 0 && (
          <div className="mt-3 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
            {modes.map((m) => (
              <div key={m} title={`${MODE_META[m].label}: ${formatKm(st.byMode.get(m)!)}`} style={{ flexGrow: st.byMode.get(m), minWidth: 3, background: MODE_META[m].color }} />
            ))}
          </div>
        )}
      </div>
      <nav className="flex gap-1 border-y border-white/[0.06] px-2 py-1.5" role="tablist">
        {tabs.map(([id, label, icon, badge]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {icon}
            <span>{label}</span>
            {badge != null && <span className="rounded-full bg-amber-400/20 px-1.5 text-[10px] font-semibold text-amber-200">{badge}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'route' && <RouteTab j={j} photos={photos} onShowPhotos={() => setTab('photos')} />}
        {tab === 'photos' && <PhotosTab j={j} photos={photos} />}
        {tab === 'stats' && <StatsTab j={j} />}
        {tab === 'share' && <ShareTab j={j} />}
      </div>
    </>
  );
}

function WorldPanel() {
  const journeys = useStore((s) => s.journeys);
  const stops = journeys.flatMap((j) => j.stops);
  const km = journeys.reduce((n, j) => n + journeyStats(j).totalKm, 0);
  const photos = journeys.reduce((n, j) => n + journeyStats(j).photoCount + (j.loosePhotoIds?.length ?? 0), 0);
  const countries = new Map<string, { code?: string; cities: Set<string> }>();
  for (const s of stops) {
    if (!s.place?.country) continue;
    const c = countries.get(s.place.country) ?? { code: s.place.countryCode, cities: new Set<string>() };
    if (s.place.city) c.cities.add(s.place.city);
    countries.set(s.place.country, c);
  }
  const cities = [...countries.values()].reduce((n, c) => n + c.cities.size, 0);

  return (
    <>
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center gap-2 text-emerald-300">
          <Globe2 size={18} />
          <h2 className="font-display text-xl font-semibold text-white">Everywhere you've been</h2>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Stat value={formatKm(km * 1000)} label="travelled" />
          <Stat value={String(countries.size)} label="countries" />
          <Stat value={String(cities)} label="cities" />
          <Stat value={String(photos)} label="photos" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto border-t border-white/[0.06] p-4 pb-24">
        {countries.size > 0 && (
          <section>
            <h3 className="section-title">Countries</h3>
            <ul className="space-y-2">
              {[...countries].map(([name, c]) => (
                <li key={name} className="text-sm">
                  <span className="mr-1.5">{flag(c.code)}</span>
                  <span className="text-slate-200">{name}</span>
                  <span className="ml-2 text-xs text-slate-500">{[...c.cities].slice(0, 6).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className="section-title">Journeys</h3>
          <ul className="space-y-1">
            {journeys.map((j) => {
              const st = journeyStats(j);
              return (
                <li key={j.id}>
                  <button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5" onClick={() => selectJourney(j.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-100">{j.title}</div>
                      <div className="text-xs text-slate-500">
                        {st.start ? new Date(st.start).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'Undated'} · {formatKm(st.totalKm * 1000)}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-500" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

type Snap = 'peek' | 'half' | 'full';
const SNAP_PX = (s: Snap) => (s === 'peek' ? 168 : s === 'half' ? Math.round(window.innerHeight * 0.5) : window.innerHeight - 64);

/** Phone layout: a draggable bottom sheet with three resting heights. */
function BottomSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snap>('peek');
  const [drag, setDrag] = useState<number>();
  const start = useRef<{ y: number; h: number } | undefined>(undefined);
  const height = drag ?? SNAP_PX(snap);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: SNAP_PX(snap) };
  };
  const onMove = (e: React.PointerEvent) => {
    if (start.current) setDrag(Math.max(120, Math.min(window.innerHeight - 40, start.current.h + start.current.y - e.clientY)));
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = undefined;
    if (!s) return;
    if (Math.abs(e.clientY - s.y) < 6) {
      // A tap on the handle toggles between peek and half.
      setSnap(snap === 'peek' ? 'half' : 'peek');
    } else {
      const h = drag ?? s.h;
      const nearest = (['peek', 'half', 'full'] as Snap[]).reduce((a, b) => (Math.abs(SNAP_PX(b) - h) < Math.abs(SNAP_PX(a) - h) ? b : a));
      setSnap(nearest);
    }
    setDrag(undefined);
  };

  return (
    <aside
      className={`glass-strong fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.45)] ${drag == null ? 'transition-[height] duration-300 ease-out' : ''}`}
      style={{ height }}
      data-snap={snap}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="button"
        aria-label={snap === 'peek' ? 'Expand panel' : 'Collapse panel'}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setSnap(snap === 'peek' ? 'half' : 'peek')}
      >
        <span className="h-1.5 w-10 rounded-full bg-white/25" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

export function Panel() {
  const j = useStore(activeJourney);
  const view = useStore((s) => s.view);
  const open = usePrefs((s) => s.panelOpen);
  const mobile = useIsMobile();
  const content = view === 'world' ? <WorldPanel /> : j ? <JourneyPanel key={j.id} j={j} /> : null;
  if (!content) return null;
  if (mobile) return <BottomSheet>{content}</BottomSheet>;
  return (
    <aside className={`glass-strong relative z-20 flex shrink-0 flex-col border-l border-white/[0.06] transition-[width] duration-300 ${open ? 'w-[360px]' : 'w-0'}`}>
      <button
        className="glass-strong absolute top-1/2 -left-7 z-10 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border-r-0 text-slate-400 hover:text-white"
        onClick={() => usePrefs.setState({ panelOpen: !open })}
        aria-label={open ? 'Hide panel' : 'Show panel'}
        title={open ? 'Hide panel' : 'Show panel'}
      >
        <ChevronRight size={16} className={`transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      <div className={`flex min-h-0 w-[360px] flex-1 flex-col overflow-hidden ${open ? '' : 'invisible'}`}>{content}</div>
    </aside>
  );
}
