import { Clapperboard, FileCode2, FileDown, Loader2, MonitorPlay, Smartphone, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { recordJourney, type Aspect } from '../../animate/recorder';
import { download, fileSafe, toGeoJSON, toGPX, toKML } from '../../export/exporters';
import { buildShareHtml } from '../../export/shareHtml';
import type { Journey } from '../../model/types';
import { notify } from '../../store';

export function ShareTab({ j }: { j: Journey }) {
  const name = fileSafe(j.title);
  const [rec, setRec] = useState<{ aspect: Aspect; phase: string }>();
  const [building, setBuilding] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);

  const record = async (aspect: Aspect) => {
    abort.current = new AbortController();
    setRec({ aspect, phase: 'Preparing…' });
    try {
      const blob = await recordJourney(j, aspect, abort.current.signal, (p) =>
        setRec((r) => (r && r.phase !== p ? { ...r, phase: p === 'title' ? 'Title card' : p === 'play' ? 'Recording the trail' : 'End card' } : r)),
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}-${aspect === '16:9' ? 'landscape' : 'portrait'}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        notify('Video saved');
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRec(undefined);
    }
  };

  const shareHtml = async () => {
    setBuilding(true);
    try {
      download(`${name}.html`, await buildShareHtml(j), 'text/html');
      notify('Share page saved. Send the file to anyone; it opens in a browser.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-7 p-4 pb-24">
      <section>
        <h3 className="section-title flex items-center gap-1.5">
          <Clapperboard size={13} /> Video
        </h3>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">Plays the trail with a title card, photo cards at each stop and a closing stats card, then saves it.</p>
        <div className="grid grid-cols-2 gap-2">
          <button className="tile-btn" disabled={!!rec || !j.segments.length} onClick={() => record('16:9')}>
            <MonitorPlay size={20} /> Landscape
            <span>16:9 · 1080p</span>
          </button>
          <button className="tile-btn" disabled={!!rec || !j.segments.length} onClick={() => record('9:16')}>
            <Smartphone size={20} /> Portrait
            <span>9:16 · stories</span>
          </button>
        </div>
        {rec && (
          <div className="fixed inset-x-0 top-4 z-[90] mx-auto flex w-fit items-center gap-3 rounded-full bg-red-500/90 px-4 py-2 text-sm font-medium text-white shadow-xl">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> {rec.phase}
            <button className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs hover:bg-white/30" onClick={() => abort.current?.abort()}>
              <Square size={11} /> Cancel
            </button>
          </div>
        )}
      </section>

      <section>
        <h3 className="section-title flex items-center gap-1.5">
          <FileCode2 size={13} /> Interactive page
        </h3>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">One .html file with the map, the animation and your photos. Anyone can open it in a browser; no app or account needed.</p>
        <button className="btn-primary w-full py-2" disabled={building} onClick={shareHtml}>
          {building ? <Loader2 size={16} className="animate-spin" /> : <FileCode2 size={16} />} Save share page
        </button>
      </section>

      <section>
        <h3 className="section-title flex items-center gap-1.5">
          <FileDown size={13} /> Map files
        </h3>
        <p className="mb-3 text-xs text-slate-500">For Google Earth, My Maps, Strava, Garmin or GIS tools.</p>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn-ghost border border-white/10" onClick={() => download(`${name}.gpx`, toGPX(j), 'application/gpx+xml')}>
            GPX
          </button>
          <button className="btn-ghost border border-white/10" onClick={() => download(`${name}.kml`, toKML(j), 'application/vnd.google-earth.kml+xml')}>
            KML
          </button>
          <button className="btn-ghost border border-white/10" onClick={() => download(`${name}.geojson`, JSON.stringify(toGeoJSON(j)), 'application/geo+json')}>
            GeoJSON
          </button>
        </div>
      </section>
    </div>
  );
}
