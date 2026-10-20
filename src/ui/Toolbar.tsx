import { Check, Hand, Keyboard, Layers, Loader2, Menu, MapPinPlus, Mountain, Plus, Redo2, Search, Undo2, X, Globe2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mapRef } from '../map/MapView';
import { usePrefs } from '../map/prefs';
import { BASE_STYLES, type BaseStyle } from '../map/styles';
import { activeJourney, addStop, canRedo, canUndo, finishDraft, redo, setTool, undo, useStore } from '../store';
import { Popover } from './Popover';
import { useIsMobile } from './useMedia';

interface PlaceHit {
  name: string;
  detail: string;
  lng: number;
  lat: number;
}

const STYLE_SWATCH: Record<BaseStyle, string> = {
  dark: 'linear-gradient(135deg,#0b1020 0%,#1e293b 60%,#334155 100%)',
  liberty: 'linear-gradient(135deg,#f2efe9 0%,#cfe6c3 55%,#a7cbe8 100%)',
  positron: 'linear-gradient(135deg,#fafafa 0%,#e5e7eb 60%,#d1d5db 100%)',
  satellite: 'linear-gradient(135deg,#1f3b2c 0%,#4b6b3a 50%,#2b4c6f 100%)',
};

function SearchBox() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const hasJourney = useStore((s) => !!activeJourney(s) && s.view === 'journey');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = await res.json();
        setHits(
          json.features.map((f: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }) => ({
            name: f.properties.name ?? f.properties.street ?? q,
            detail: [f.properties.city, f.properties.state, f.properties.country].filter(Boolean).join(', '),
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
        );
        setActive(0);
      } catch {
        // aborted or offline
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => ctrl.abort();
  }, [q]);

  const go = (h: PlaceHit, add: boolean) => {
    mapRef.current?.flyTo({ center: [h.lng, h.lat], zoom: 13, duration: 1500 });
    if (add) addStop(h.lng, h.lat, h.name);
    setQ('');
    setHits([]);
  };

  return (
    <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
      <input
        className="input glass-strong h-10 pr-8 pl-9"
        placeholder="Search a place…"
        value={q}
        aria-label="Search places"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') setActive((a) => Math.min(hits.length - 1, a + 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          else if (e.key === 'Enter' && hits[active]) go(hits[active], e.shiftKey && hasJourney);
          else if (e.key === 'Escape') setQ('');
          else return;
          e.preventDefault();
        }}
      />
      {loading && <Loader2 size={14} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-slate-500" />}
      {!loading && q && (
        <button className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-slate-500 hover:text-white" onClick={() => setQ('')} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
      {hits.length > 0 && (
        <ul className="glass-strong pop-in absolute top-full z-40 mt-2 w-full min-w-72 overflow-hidden rounded-xl p-1 text-sm shadow-2xl" role="listbox">
          {hits.map((h, i) => (
            <li key={i} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`} onPointerEnter={() => setActive(i)}>
              <button className="min-w-0 flex-1 text-left" onClick={() => go(h, false)}>
                <div className="truncate text-slate-100">{h.name}</div>
                <div className="truncate text-xs text-slate-500">{h.detail}</div>
              </button>
              {hasJourney && (
                <button className="btn-ghost shrink-0 px-2 py-1 text-xs text-emerald-300" onClick={() => go(h, true)} title="Add as a stop (Shift+Enter)">
                  <Plus size={13} /> Stop
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LayersMenu() {
  const prefs = usePrefs();
  return (
    <Popover label="Map layers" align="right" triggerClassName="icon-btn glass-strong h-10 w-10" trigger={<Layers size={18} />} className="w-64 p-2.5">
      {() => (
        <>
          <div className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Map style</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BASE_STYLES) as BaseStyle[]).map((k) => (
              <button key={k} onClick={() => usePrefs.setState({ base: k })} className={`group overflow-hidden rounded-lg border text-left text-xs transition ${prefs.base === k ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-white/10 hover:border-white/30'}`}>
                <div className="relative h-12" style={{ background: STYLE_SWATCH[k] }}>
                  {prefs.base === k && (
                    <span className="absolute top-1 right-1 rounded-full bg-emerald-400 p-0.5 text-slate-950">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5 text-slate-200">{BASE_STYLES[k].label}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            <Toggle icon={<Mountain size={15} />} label="3D terrain" on={prefs.terrain} onChange={(v) => usePrefs.setState({ terrain: v })} />
            <Toggle icon={<Globe2 size={15} />} label="Globe when zoomed out" on={prefs.globe} onChange={(v) => usePrefs.setState({ globe: v })} />
          </div>
        </>
      )}
    </Popover>
  );
}

function Toggle({ icon, label, on, onChange }: { icon: React.ReactNode; label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5">
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-emerald-400' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const j = useStore(activeJourney);
  const view = useStore((s) => s.view);
  useStore((s) => s.historyVersion);
  const draftLen = useStore((s) => s.draft?.length ?? 0);
  const mobile = useIsMobile();
  const editing = !!j && view === 'journey';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
      <div className="flex items-center gap-2">
        {mobile && (
          <button className="icon-btn glass-strong pointer-events-auto h-10 w-10 shrink-0" onClick={() => useStore.setState({ drawerOpen: true })} aria-label="Open journeys">
            <Menu size={18} />
          </button>
        )}
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <SearchBox />
        </div>
        {editing && (
          <div className="glass-strong pointer-events-auto flex shrink-0 rounded-xl p-1" role="radiogroup" aria-label="Map tool">
            <button role="radio" aria-checked={tool === 'view'} className={`seg-btn ${tool === 'view' ? 'active' : ''}`} onClick={() => setTool('view')} title="Explore (V)">
              <Hand size={15} />
              {!mobile && 'Explore'}
            </button>
            <button role="radio" aria-checked={tool === 'add'} className={`seg-btn ${tool === 'add' ? 'active' : ''}`} onClick={() => setTool(tool === 'add' ? 'view' : 'add')} title="Add stops: click the map; drag stops to move (A)">
              <MapPinPlus size={15} />
              {!mobile && 'Add stops'}
            </button>
          </div>
        )}
        {editing && !mobile && (
          <div className="glass-strong pointer-events-auto flex shrink-0 rounded-xl p-1">
            <button className="icon-btn h-8 w-8" onClick={undo} disabled={!canUndo(j?.id)} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 size={16} />
            </button>
            <button className="icon-btn h-8 w-8" onClick={redo} disabled={!canRedo(j?.id)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Redo2 size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 max-sm:hidden" />
        <div className="pointer-events-auto flex shrink-0 gap-2">
          {!mobile && (
            <button className="icon-btn glass-strong h-10 w-10" onClick={() => useStore.setState({ shortcutsOpen: true })} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
              <Keyboard size={17} />
            </button>
          )}
          <LayersMenu />
        </div>
      </div>
      {(tool === 'draw' || tool === 'pin' || tool === 'add') && editing && (
        <div className="glass-strong pop-in pointer-events-auto mx-auto mt-2 flex w-fit max-w-full items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-sm text-amber-100">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-300" />
          <span className="truncate">
            {tool === 'draw' ? `Click along the way to trace the path · ${draftLen} points` : tool === 'pin' ? 'Click where this photo was taken' : 'Click the map to add a stop · drag stops to move them'}
          </span>
          {tool === 'draw' && (
            <button className="btn-primary px-3 py-1" onClick={finishDraft} disabled={!draftLen}>
              Done
            </button>
          )}
          <button className="btn-ghost px-3 py-1" onClick={() => setTool('view')}>
            {tool === 'add' ? 'Finish' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}
