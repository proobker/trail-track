import { ExternalLink, Loader2, MapPinned, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Journey } from '../../model/types';
import { setNamedTrail, useStore } from '../../store';
import { findNearbyTrails, type TrailCandidate } from '../../trail/namedTrails';

const sourceUrl = (trail: { source: 'osm' | 'usgs'; type: string; id: number }) => trail.source === 'osm'
  ? `https://www.openstreetmap.org/${trail.type}/${trail.id}`
  : `https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37/query?f=geojson&objectIds=${trail.id}&outFields=*&returnGeometry=true`;

export function NamedTrails({ journey, selectedSegmentId }: { journey: Journey; selectedSegmentId?: string }) {
  const [candidates, setCandidates] = useState<TrailCandidate[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const preview = useStore((s) => s.trailPreview);
  const selectedWalk = journey.segments.some((s) => s.id === selectedSegmentId && s.mode === 'walk') ? selectedSegmentId : undefined;

  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    setCandidates(undefined);
    setError(undefined);
    setBusy(false);
    useStore.setState({ trailPreview: undefined });
    return () => {
      request.current?.abort();
      useStore.setState({ trailPreview: undefined });
    };
  }, [journey.id, selectedWalk]);

  if (!journey.segments.some((s) => s.mode === 'walk')) return null;

  const search = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    setCandidates(undefined);
    useStore.setState({ trailPreview: undefined });
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      setCandidates(await findNearbyTrails(journey, selectedWalk, controller.signal));
    } catch (err) {
      if (request.current === controller) setError(controller.signal.aborted ? 'Trail search timed out. Please try again.' : err instanceof Error ? err.message : 'Trail search failed.');
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
      }
    }
  };

  return (
    <section className="m-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
      <div className="flex items-start gap-2">
        <MapPinned size={16} className="mt-0.5 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-100">Named trail</div>
          <p className="mt-1 leading-relaxed text-slate-400">Find trails mapped near your {selectedWalk ? 'selected walking leg' : 'walking route'}. These are suggestions, especially where GPS is sparse. Preview before confirming; your route stays as drawn.</p>
        </div>
      </div>
      {journey.namedTrail && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-400/10 px-2.5 py-2 text-emerald-100">
          <span className="min-w-0 flex-1 truncate font-medium">{journey.namedTrail.name}{journey.namedTrail.ref && journey.namedTrail.ref !== journey.namedTrail.name ? ` (${journey.namedTrail.ref})` : ''}</span>
          <a href={sourceUrl(journey.namedTrail)} target="_blank" rel="noreferrer" aria-label="View trail source" title="View trail source"><ExternalLink size={14} /></a>
          <button onClick={() => setNamedTrail(journey.id)} className="rounded p-0.5 hover:bg-white/10" aria-label="Remove named trail" title="Remove named trail"><X size={14} /></button>
        </div>
      )}
      {journey.namedTrail && <p className="mt-1 text-[11px] text-slate-500">{journey.namedTrail.source === 'osm' ? <>Trail data © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></> : 'Trail data: USGS The National Map'}</p>}
      <button className="btn-ghost mt-3 w-full border border-white/15 py-1.5 text-xs" onClick={search} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Looking for trails…' : selectedWalk ? 'Find trails near this leg' : 'Find nearby trails'}
      </button>
      {error && <p className="mt-2 text-amber-200" role="alert">{error}</p>}
      {candidates && !candidates.length && <p className="mt-2 text-slate-400">No named trails were found near these stops. Try a shorter walking leg or import a recorded track.</p>}
      {candidates && candidates.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-slate-400">Possible matches · <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>{candidates.some((c) => c.source === 'usgs') ? ' · USGS The National Map' : ''}</p>
          {candidates.map((candidate) => {
            const active = preview?.source === candidate.source && preview.type === candidate.type && preview.id === candidate.id;
            return (
              <div key={`${candidate.source}/${candidate.type}/${candidate.id}`} className={`rounded-lg border p-2 ${active ? 'border-yellow-300/60 bg-yellow-300/10' : 'border-white/10 bg-slate-900/40'}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-100" title={candidate.name}>{candidate.name}</div>
                    <div className="mt-0.5 text-slate-400">Near {candidate.nearStops} of {candidate.totalStops} route samples · {candidate.source === 'osm' ? 'OpenStreetMap' : 'USGS'}{candidate.ref && candidate.ref !== candidate.name ? ` · ${candidate.ref}` : ''}</div>
                    {(candidate.difficulty || candidate.visibility) && <div className="mt-0.5 text-amber-200">{candidate.difficulty ? `Difficulty: ${candidate.difficulty.replaceAll('_', ' ')}` : ''}{candidate.difficulty && candidate.visibility ? ' · ' : ''}{candidate.visibility ? `Visibility: ${candidate.visibility.replaceAll('_', ' ')}` : ''}</div>}
                  </div>
                  <a href={sourceUrl(candidate)} target="_blank" rel="noreferrer" aria-label={`View ${candidate.name} source`} className="text-slate-400 hover:text-white"><ExternalLink size={14} /></a>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost flex-1 border border-white/15 py-1 text-xs" onClick={() => useStore.setState({ trailPreview: active ? undefined : candidate })}>{active ? 'Hide preview' : 'Preview on map'}</button>
                  <button className="btn-primary flex-1 py-1 text-xs" onClick={() => {
                    setNamedTrail(journey.id, { source: candidate.source, type: candidate.type, id: candidate.id, name: candidate.name, ref: candidate.ref });
                    useStore.setState({ trailPreview: undefined });
                  }}>Use name</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
