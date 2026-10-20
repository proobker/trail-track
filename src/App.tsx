import { Compass, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MapView } from './map/MapView';
import { activeJourney, loadJourneys, useStore } from './store';
import { Dialog } from './ui/Dialog';
import { Lightbox } from './ui/Lightbox';
import { Panel } from './ui/Panel';
import { PlaybackCard, PlayerBar } from './ui/PlayerBar';
import { ShortcutsSheet, useShortcuts } from './ui/shortcuts';
import { Sidebar } from './ui/Sidebar';
import { Toolbar } from './ui/Toolbar';
import { useIsMobile } from './ui/useMedia';
import { Wizard } from './ui/Wizard';

function Toast() {
  const toast = useStore((s) => s.toast);
  const mobile = useIsMobile();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.action ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={`glass-strong pop-in fixed left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl py-2.5 pr-2.5 pl-4 text-sm text-white shadow-xl ${mobile ? 'top-20' : 'bottom-28'}`}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-white/20"
          onClick={() => {
            toast.action!.run();
            setVisible(false);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

function Welcome() {
  const hasJourneys = useStore((s) => s.journeys.length > 0);
  const active = useStore(activeJourney);
  const view = useStore((s) => s.view);
  if (active || view === 'world') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="glass-strong pop-in pointer-events-auto max-w-md rounded-3xl p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-cyan-500 text-slate-950 shadow-[0_0_40px_rgba(52,211,153,0.4)]">
          <Compass size={30} strokeWidth={2.2} />
        </div>
        <h1 className="font-display mb-2 text-3xl font-semibold text-white">Where have you been?</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">
          Turn your photos into an animated trail. Filter by date and by who's in them, set how you travelled each leg, add notes, and share the trip as a video or a page.
        </p>
        <button className="btn-primary px-5 py-2.5 text-base" onClick={() => useStore.setState({ wizardOpen: true })}>
          <Plus size={18} strokeWidth={2.5} /> {hasJourneys ? 'Start another journey' : 'Start your first journey'}
        </button>
      </div>
    </div>
  );
}

export function App() {
  useShortcuts();
  useEffect(() => {
    void loadJourneys();
  }, []);
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <MapView />
        <Toolbar />
        <Welcome />
        <PlaybackCard />
        <PlayerBar />
      </main>
      <Panel />
      <Wizard />
      <Lightbox />
      <Dialog />
      <ShortcutsSheet />
      <Toast />
    </div>
  );
}
