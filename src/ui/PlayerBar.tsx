import { useRef, useState } from 'react';
import { fileSafe } from '../export/exporters';
import { mapRef } from '../map/MapView';
import { thumbUrl, useJourneyPhotos } from '../model/photos';
import { activeJourney, notify, setPlayer, useStore } from '../store';

const SPEEDS = [0.5, 1, 2, 4];

export function PlayerBar() {
  const j = useStore(activeJourney);
  const player = useStore((s) => s.player);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  if (!j || j.segments.length === 0) return null;

  const play = () => {
    if (player.playing) return setPlayer({ playing: false });
    useStore.setState({ selectedStopId: undefined, selectedSegmentId: undefined });
    setPlayer({ playing: true, progress: player.progress >= 1 ? 0 : player.progress });
  };

  const record = () => {
    if (recording) return recorder.current?.stop();
    const canvas = mapRef.current?.getCanvas();
    if (!canvas || typeof MediaRecorder === 'undefined') return notify('Recording is not supported in this browser');
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileSafe(j.title)}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      unsub();
    };
    // Stop automatically when playback reaches the end.
    const unsub = useStore.subscribe((s) => {
      if (!s.player.playing && rec.state === 'recording') rec.stop();
    });
    recorder.current = rec;
    rec.start();
    setRecording(true);
    setPlayer({ playing: true, progress: 0, follow: true });
  };

  return (
    <div className="glass absolute bottom-4 left-1/2 z-10 flex w-[min(640px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-2.5 shadow-2xl">
      <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-lg text-slate-950 transition hover:scale-105" onClick={play} aria-label={player.playing ? 'Pause' : 'Play'}>
        {player.playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(player.progress * 1000)}
        onChange={(e) => setPlayer({ progress: Number(e.target.value) / 1000 })}
        className="flex-1"
        aria-label="Playback position"
      />
      <button className="btn-ghost w-12 px-1 text-xs" onClick={() => setPlayer({ speed: SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length] })} title="Playback speed">
        {player.speed}×
      </button>
      <button className={`btn-ghost px-2 text-xs ${player.follow ? 'active' : ''}`} onClick={() => setPlayer({ follow: !player.follow })} title="Camera follows the trail">
        🎥 Follow
      </button>
      <button className={`btn-ghost px-2 text-xs ${recording ? 'text-red-400' : ''}`} onClick={record} title="Record the animation as a video">
        {recording ? '■ Stop' : '● Rec'}
      </button>
    </div>
  );
}

/** Shows the photos of the stop the animation is pausing at. */
export function PlaybackCard() {
  const j = useStore(activeJourney);
  const playhead = useStore((s) => s.playhead);
  const photos = useJourneyPhotos(j);
  const stop = playhead?.pauseStop != null ? j?.stops[playhead.pauseStop] : undefined;
  if (!stop || stop.photoIds.length === 0) return null;
  const shown = stop.photoIds.slice(0, 4);
  return (
    <div key={stop.id} className="pop-in glass absolute bottom-24 left-4 z-10 w-[min(300px,calc(100%-2rem))] rounded-2xl p-2.5 shadow-2xl">
      <div className={`grid gap-1.5 ${shown.length > 1 ? 'grid-cols-2' : ''}`}>
        {shown.map((id) => {
          const url = thumbUrl(photos.get(id));
          return url ? <img key={id} src={url} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" /> : null;
        })}
      </div>
      <div className="mt-2 flex justify-between text-sm">
        <span className="font-medium text-white">{stop.label ?? `Stop ${playhead!.pauseStop! + 1}`}</span>
        <span className="text-slate-400">{stop.arrivedAt ? new Date(stop.arrivedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
      </div>
    </div>
  );
}
