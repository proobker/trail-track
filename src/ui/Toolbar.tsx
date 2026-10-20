import { useEffect, useRef, useState } from 'react';
import { mapRef } from '../map/MapView';
import { usePrefs } from '../map/prefs';
import { BASE_STYLES, type BaseStyle } from '../map/styles';
import { activeJourney, addStop, finishDraft, setTool, useStore } from '../store';

interface PlaceHit {
  name: string;
  detail: string;
  lng: number;
  lat: number;
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const hasJourney = useStore((s) => !!activeJourney(s));
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 3) return setHits([]);
    const ctrl = new AbortController();
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
      } catch {
        // aborted or offline
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
    <div className="relative w-72">
      <input className="input glass" placeholder="Search places…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="glass absolute top-full mt-1 w-full overflow-hidden rounded-lg text-sm">
          {hits.map((h, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2 hover:bg-white/5">
              <button className="min-w-0 flex-1 text-left" onClick={() => go(h, false)}>
                <div className="truncate text-slate-100">{h.name}</div>
                <div className="truncate text-xs text-slate-500">{h.detail}</div>
              </button>
              {hasJourney && (
                <button className="btn-ghost shrink-0 px-2 text-xs text-emerald-300" onClick={() => go(h, true)} title="Add as a stop">
                  + stop
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const hasJourney = useStore((s) => !!activeJourney(s));
  const draftLen = useStore((s) => s.draft?.length ?? 0);
  const prefs = usePrefs();

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-3">
      <div className="pointer-events-auto">
        <SearchBox />
      </div>
      {hasJourney && (
        <div className="glass pointer-events-auto flex rounded-lg p-1">
          <button className={`btn-ghost ${tool === 'view' ? 'active' : ''}`} onClick={() => setTool('view')} title="Explore the map">
            ✋ View
          </button>
          <button className={`btn-ghost ${tool === 'add' ? 'active' : ''}`} onClick={() => setTool(tool === 'add' ? 'view' : 'add')} title="Click the map to add stops; drag stops to move them">
            📍 Add stops
          </button>
        </div>
      )}
      {(tool === 'draw' || tool === 'pin') && (
        <div className="glass pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-amber-200">
          {tool === 'draw' ? `Click to trace the path (${draftLen} points)` : 'Click where the photo was taken'}
          {tool === 'draw' && (
            <button className="btn-primary px-2 py-0.5" onClick={finishDraft} disabled={!draftLen}>
              Done
            </button>
          )}
          <button className="btn-ghost px-2 py-0.5" onClick={() => setTool('view')}>
            Cancel
          </button>
        </div>
      )}
      <div className="flex-1" />
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-lg p-1">
        {(Object.keys(BASE_STYLES) as BaseStyle[]).map((k) => (
          <button key={k} className={`btn-ghost px-2 text-xs ${prefs.base === k ? 'active' : ''}`} onClick={() => usePrefs.setState({ base: k })}>
            {BASE_STYLES[k].label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button className={`btn-ghost px-2 text-xs ${prefs.terrain ? 'active' : ''}`} onClick={() => usePrefs.setState({ terrain: !prefs.terrain })} title="3D terrain">
          ⛰ 3D
        </button>
        <button className={`btn-ghost px-2 text-xs ${prefs.globe ? 'active' : ''}`} onClick={() => usePrefs.setState({ globe: !prefs.globe })} title="Globe view when zoomed out">
          🌍 Globe
        </button>
      </div>
    </div>
  );
}
