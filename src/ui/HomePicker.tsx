import { LocateFixed, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reverseGeocode } from '../geo/reverse';
import { usePrefs } from '../map/prefs';

interface Hit {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

/** Lets the user set home by searching for a place or using this device's location. Saved in this browser. */
export function HomePicker({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = await res.json();
        setHits(json.features.map((f: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }) => ({
          name: f.properties.name ?? f.properties.city ?? q,
          detail: [f.properties.city, f.properties.state, f.properties.country].filter((s) => s && s !== f.properties.name).join(', '),
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        })));
      } catch {
        // aborted or offline
      }
    }, 300);
    return () => (window.clearTimeout(timer), ctrl.abort());
  }, [q]);

  const save = (lat: number, lng: number, name?: string) => {
    usePrefs.setState({ home: { lat, lng, name } });
    onDone();
  };

  const useMyLocation = () => {
    setError(undefined);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const place = await reverseGeocode(coords.longitude, coords.latitude);
        setLocating(false);
        save(coords.latitude, coords.longitude, place?.city ?? place?.name);
      },
      () => {
        setLocating(false);
        setError('Location is unavailable or was not allowed. Search for your town instead.');
      },
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  };

  return (
    <div className="space-y-2 rounded-xl bg-white/[0.03] p-2">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
        <input className="input h-9 pr-8 pl-8 text-sm" autoFocus placeholder="Search your home town…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Cancel" onClick={onDone}>
          <X size={14} />
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="space-y-0.5">
          {hits.map((h, i) => (
            <li key={i}>
              <button className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5" onClick={() => save(h.lat, h.lng, h.name)}>
                <span className="text-slate-200">{h.name}</span>
                {h.detail && <span className="ml-1.5 text-xs text-slate-500">{h.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn-ghost w-full border border-white/10 py-1.5 text-xs" disabled={locating} onClick={useMyLocation}>
        <LocateFixed size={13} /> {locating ? 'Finding you…' : 'Use my current location'}
      </button>
      {error && <p className="text-xs text-amber-200">{error}</p>}
    </div>
  );
}
