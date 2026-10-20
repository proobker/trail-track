import { X } from 'lucide-react';
import { useEffect } from 'react';
import { fitJourney, mapRef } from '../map/MapView';
import { activeJourney, deleteStop, openLightbox, redo, selectStopByOffset, setTool, togglePlay, undo, useStore } from '../store';

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['V', 'Explore tool'],
  ['A', 'Add stops tool'],
  ['← →', 'Previous / next stop'],
  ['L', 'Open photos of the selected stop'],
  ['F', 'Fit the journey in view'],
  ['Delete', 'Remove the selected stop'],
  ['Ctrl Z', 'Undo'],
  ['Ctrl Shift Z', 'Redo'],
  ['Esc', 'Cancel tool / deselect'],
  ['?', 'Show this list'],
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (typing(e.target) || s.dialog || s.wizardOpen || s.lightbox) return;
      const j = activeJourney(s);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.shiftKey ? redo() : undo();
      } else if (mod && key === 'y') {
        redo();
      } else if (mod || e.altKey) {
        return;
      } else if (e.key === '?') {
        useStore.setState({ shortcutsOpen: !s.shortcutsOpen });
      } else if (e.key === 'Escape') {
        if (s.shortcutsOpen) useStore.setState({ shortcutsOpen: false });
        else if (s.tool !== 'view') setTool('view');
        else useStore.setState({ selectedStopId: undefined, selectedSegmentId: undefined });
      } else if (!j || s.view !== 'journey') {
        return;
      } else if (e.key === ' ') {
        // Let a focused button handle its own Space press.
        if (e.target instanceof HTMLButtonElement) return;
        togglePlay();
      } else if (key === 'v') {
        setTool('view');
      } else if (key === 'a') {
        setTool(s.tool === 'add' ? 'view' : 'add');
      } else if (key === 'f') {
        if (mapRef.current) fitJourney(mapRef.current, j);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const stop = selectStopByOffset(e.key === 'ArrowRight' ? 1 : -1);
        if (stop) mapRef.current?.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 800 });
      } else if (key === 'l') {
        const stop = j.stops.find((x) => x.id === s.selectedStopId);
        if (stop?.photoIds.length) openLightbox(stop.photoIds);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedStopId) {
        deleteStop(s.selectedStopId);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function ShortcutsSheet() {
  const open = useStore((s) => s.shortcutsOpen);
  if (!open) return null;
  const close = () => useStore.setState({ shortcutsOpen: false });
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="glass-strong pop-in w-full max-w-sm rounded-2xl p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">Keyboard shortcuts</h2>
          <button className="icon-btn h-8 w-8" onClick={close} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <dt className="text-slate-300">{label}</dt>
              <dd className="flex gap-1">
                {k.split(' ').map((part) => (
                  <kbd key={part} className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-xs text-slate-200">
                    {part}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
