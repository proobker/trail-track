import { googleConfigured, signIn, signOut, useAuth } from '../auth/google';
import { backupJSON, download, restoreBackup } from '../export/exporters';
import { deleteJourney, loadJourneys, notify, selectJourney, useStore } from '../store';
import { journeyStats } from '../trail/journey';

export function Sidebar() {
  const journeys = useStore((s) => s.journeys);
  const activeId = useStore((s) => s.activeId);
  const user = useAuth((s) => s.user);

  const restore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const n = await restoreBackup(await f.text());
        await loadJourneys();
        notify(`Restored ${n} journey${n === 1 ? '' : 's'}`);
      } catch (e) {
        notify((e as Error).message);
      }
    };
    input.click();
  };

  return (
    <aside className="glass z-20 flex w-72 shrink-0 flex-col border-y-0 border-l-0">
      <div className="flex items-center gap-2 px-5 pt-5 pb-4">
        <span className="text-2xl">🧭</span>
        <div>
          <div className="font-display text-lg leading-none font-semibold text-white">Trail Track</div>
          <div className="text-xs text-slate-400">your photos, mapped</div>
        </div>
      </div>

      <div className="px-4">
        <button className="btn-primary w-full py-2" onClick={() => useStore.setState({ wizardOpen: true })}>
          + New journey
        </button>
      </div>

      <div className="mt-4 flex-1 space-y-1 overflow-y-auto px-2">
        {journeys.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No journeys yet. Start one from your photos, a track file or by hand.</p>}
        {journeys.map((j) => {
          const st = journeyStats(j);
          return (
            <div
              key={j.id}
              role="button"
              tabIndex={0}
              onClick={() => selectJourney(j.id)}
              onKeyDown={(e) => e.key === 'Enter' && selectJourney(j.id)}
              className={`group cursor-pointer rounded-xl px-3 py-2.5 transition ${j.id === activeId ? 'bg-emerald-400/15 ring-1 ring-emerald-400/40' : 'hover:bg-white/5'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-medium text-slate-100">{j.title}</div>
                <button
                  className="text-xs text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400"
                  title="Delete journey"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete “${j.title}”? Photos stay on this device for other journeys.`)) void deleteJourney(j.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="text-xs text-slate-400">
                {j.stops.length} stops · {st.totalKm < 10 ? st.totalKm.toFixed(1) : Math.round(st.totalKm).toLocaleString()} km · {st.photoCount + (j.loosePhotoIds?.length ?? 0)} photos
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 border border-white/10 text-xs" disabled={!journeys.length} onClick={async () => download(`trail-track-backup-${new Date().toISOString().slice(0, 10)}.json`, await backupJSON(journeys), 'application/json')}>
            Back up
          </button>
          <button className="btn-ghost flex-1 border border-white/10 text-xs" onClick={restore}>
            Restore
          </button>
        </div>
        {user ? (
          <div className="flex items-center gap-2">
            {user.picture ? <img src={user.picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-8 w-8 rounded-full bg-emerald-500" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{user.name}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <button
            className="btn-ghost w-full border border-white/10"
            disabled={!googleConfigured()}
            title={googleConfigured() ? '' : 'Set VITE_GOOGLE_CLIENT_ID to enable'}
            onClick={() => signIn().catch((e) => notify(e.message))}
          >
            <GoogleG /> Sign in with Google
          </button>
        )}
        <p className="text-[11px] leading-snug text-slate-500">Journeys and photos are stored only in this browser.</p>
      </div>
    </aside>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
