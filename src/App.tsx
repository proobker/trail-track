import { useEffect, useState } from 'react';
import { MapView } from './map/MapView';
import { activeJourney, loadJourneys, useStore } from './store';
import { Panel } from './ui/Panel';
import { PlaybackCard, PlayerBar } from './ui/PlayerBar';
import { Sidebar } from './ui/Sidebar';
import { Toolbar } from './ui/Toolbar';
import { Wizard } from './ui/Wizard';

function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div key={toast.id} className="glass pop-in fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-xl">
      {toast.text}
    </div>
  );
}

function Welcome() {
  const hasJourneys = useStore((s) => s.journeys.length > 0);
  const active = useStore(activeJourney);
  if (active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="glass pop-in pointer-events-auto max-w-md rounded-2xl p-8 text-center shadow-2xl">
        <div className="mb-3 text-5xl">🗺️</div>
        <h1 className="font-display mb-2 text-3xl font-semibold text-white">Where have you been?</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">
          Turn your photos into an animated trail. Filter by date and by who's in them, set how you travelled each leg, or draw and import routes yourself.
        </p>
        <button className="btn-primary px-5 py-2.5 text-base" onClick={() => useStore.setState({ wizardOpen: true })}>
          {hasJourneys ? 'Start another journey' : 'Start your first journey'} →
        </button>
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    void loadJourneys();
  }, []);
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden">
        <MapView />
        <Toolbar />
        <Welcome />
        <PlaybackCard />
        <PlayerBar />
      </main>
      <Panel />
      <Wizard />
      <Toast />
    </div>
  );
}
