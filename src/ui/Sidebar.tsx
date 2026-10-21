import { ChevronsLeft, ChevronsRight, Compass, DatabaseBackup, Globe2, LogOut, MoreHorizontal, Plus, Trash2, Upload, X } from 'lucide-react';
import { googleConfigured, signIn, signOut, useAuth } from '../auth/google';
import { backupJSON, download, restoreBackup } from '../export/exporters';
import { usePrefs } from '../map/prefs';
import { MODE_META, STACK_ORDER, type Journey } from '../model/types';
import { confirmDialog, deleteJourney, loadJourneys, notify, selectJourney, showWorld, useStore } from '../store';
import { journeyStats } from '../trail/journey';
import { formatKm } from './ModeChip';
import { MenuItem, Popover } from './Popover';
import { useIsMobile } from './useMedia';

function JourneyCard({ j, active }: { j: Journey; active: boolean }) {
  const st = journeyStats(j);
  const modes = STACK_ORDER.filter((m) => st.byMode.get(m));
  const when = st.start != null ? new Date(st.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Undated';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active}
      onClick={() => selectJourney(j.id)}
      onKeyDown={(e) => e.key === 'Enter' && selectJourney(j.id)}
      className={`group relative cursor-pointer rounded-xl px-3 py-2.5 transition ${active ? 'bg-emerald-400/[0.12] ring-1 ring-emerald-400/40' : 'hover:bg-white/[0.05]'}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100" title={j.title}>{j.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {when}{j.stops.length > 0 ? ` · ${formatKm(st.totalKm * 1000)} · ${j.stops.length} stops` : ' · Not mapped yet'} · {st.photoCount + st.loosePhotoCount} photos
          </div>
          {st.loosePhotoCount > 0 && <div className="mt-0.5 text-xs text-amber-300/80">{st.loosePhotoCount} photo{st.loosePhotoCount === 1 ? '' : 's'} need{st.loosePhotoCount === 1 ? 's' : ''} a place</div>}
        </div>
        <Popover label="Journey actions" align="right" triggerClassName="icon-btn -mr-1 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" trigger={<MoreHorizontal size={15} />} className="w-44">
          {(close) => (
            <MenuItem
              icon={<Trash2 size={15} />}
              danger
              onClick={async () => {
                close();
                if (await confirmDialog({ title: `Delete “${j.title}”?`, body: 'The journey is removed from this browser. Its photos stay available to other journeys.', confirmLabel: 'Delete', danger: true })) void deleteJourney(j.id);
              }}
            >
              Delete journey
            </MenuItem>
          )}
        </Popover>
      </div>
      {modes.length > 0 && (
        <div className="mt-2 flex h-1 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
          {modes.map((m) => (
            <div key={m} style={{ flexGrow: st.byMode.get(m), minWidth: 2, background: MODE_META[m].color }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Account({ compact }: { compact?: boolean }) {
  const user = useAuth((s) => s.user);
  if (user)
    return (
      <div className="flex items-center gap-2.5">
        {user.picture ? <img src={user.picture} alt="" className="h-8 w-8 shrink-0 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-8 w-8 shrink-0 rounded-full bg-emerald-500" />}
        {!compact && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{user.name}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button className="icon-btn h-8 w-8" onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={15} />
            </button>
          </>
        )}
      </div>
    );
  return (
    <button
      className={`btn-ghost w-full border border-white/10 ${compact ? 'h-10 px-0' : ''}`}
      disabled={!googleConfigured()}
      title={googleConfigured() ? 'Sign in with Google' : 'Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in'}
      onClick={() => signIn().catch((e) => notify(e.message))}
    >
      <GoogleG />
      {!compact && 'Sign in with Google'}
    </button>
  );
}

function backup(journeys: Journey[]) {
  return async () => download(`trail-track-backup-${new Date().toISOString().slice(0, 10)}.json`, await backupJSON(journeys), 'application/json');
}

function restore() {
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
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const journeys = useStore((s) => s.journeys);
  const activeId = useStore((s) => s.activeId);
  const view = useStore((s) => s.view);
  return (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-300 to-cyan-500 text-slate-950 shadow-[0_0_24px_rgba(52,211,153,0.35)]">
          <Compass size={20} strokeWidth={2.4} />
        </div>
        <div className="flex-1">
          <div className="font-display text-[17px] leading-none font-semibold text-white">Trail Track</div>
          <div className="mt-1 text-[11px] text-slate-500">your photos, mapped</div>
        </div>
        {onClose ? (
          <button className="icon-btn h-8 w-8" onClick={onClose} aria-label="Close menu">
            <X size={17} />
          </button>
        ) : (
          <button className="icon-btn h-8 w-8" onClick={() => usePrefs.setState({ sidebarOpen: false })} aria-label="Collapse sidebar" title="Collapse sidebar">
            <ChevronsLeft size={17} />
          </button>
        )}
      </div>

      <div className="px-3">
        <button className="btn-primary w-full py-2.5" onClick={() => useStore.setState({ wizardOpen: true, drawerOpen: false })}>
          <Plus size={17} strokeWidth={2.5} /> New journey
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        {journeys.length > 0 && (
          <button
            onClick={showWorld}
            className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${view === 'world' ? 'bg-emerald-400/[0.12] ring-1 ring-emerald-400/40' : 'hover:bg-white/[0.05]'}`}
          >
            <Globe2 size={18} className="text-emerald-300" />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-100">All journeys</div>
              <div className="text-xs text-slate-500">Map of everywhere you've been</div>
            </div>
          </button>
        )}
        <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Journeys</div>
        {journeys.length === 0 && <p className="px-3 py-6 text-sm leading-relaxed text-slate-500">Nothing here yet. Start a journey from your photos, a track file, or by drawing on the map.</p>}
        <div className="space-y-1 pb-4">
          {journeys.map((j) => (
            <JourneyCard key={j.id} j={j} active={view === 'journey' && j.id === activeId} />
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-white/[0.06] p-3">
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 border border-white/10 text-xs" disabled={!journeys.length} onClick={backup(journeys)} title="Download everything as one file">
            <DatabaseBackup size={14} /> Back up
          </button>
          <button className="btn-ghost flex-1 border border-white/10 text-xs" onClick={restore}>
            <Upload size={14} /> Restore
          </button>
        </div>
        <Account />
        <p className="px-1 text-[11px] leading-snug text-slate-600">Everything stays in this browser.</p>
      </div>
    </>
  );
}

/** Collapsed desktop sidebar: an icon rail. */
function Rail() {
  const journeys = useStore((s) => s.journeys);
  const activeId = useStore((s) => s.activeId);
  const view = useStore((s) => s.view);
  return (
    <aside className="glass-strong z-20 flex w-16 shrink-0 flex-col items-center gap-2 border-r border-white/[0.06] py-3">
      <button className="icon-btn h-10 w-10" onClick={() => usePrefs.setState({ sidebarOpen: true })} title="Expand sidebar" aria-label="Expand sidebar">
        <ChevronsRight size={18} />
      </button>
      <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-slate-950 hover:bg-emerald-300" onClick={() => useStore.setState({ wizardOpen: true })} title="New journey" aria-label="New journey">
        <Plus size={19} strokeWidth={2.5} />
      </button>
      {journeys.length > 0 && (
        <button className={`icon-btn h-10 w-10 ${view === 'world' ? 'bg-white/10 text-emerald-300' : ''}`} onClick={showWorld} title="All journeys" aria-label="All journeys">
          <Globe2 size={18} />
        </button>
      )}
      <div className="my-1 h-px w-8 bg-white/10" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
        {journeys.map((j) => (
          <button
            key={j.id}
            onClick={() => selectJourney(j.id)}
            title={j.title}
            aria-label={j.title}
            className={`h-9 w-9 shrink-0 rounded-lg text-xs font-semibold transition ${view === 'journey' && j.id === activeId ? 'bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/50' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            {j.title
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join('')}
          </button>
        ))}
      </div>
      <div className="w-10">
        <Account compact />
      </div>
    </aside>
  );
}

export function Sidebar() {
  const open = usePrefs((s) => s.sidebarOpen);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <>
        <div className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => useStore.setState({ drawerOpen: false })} />
        <aside
          className={`glass-strong fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-80 flex-col shadow-2xl transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
          aria-hidden={!drawerOpen}
        >
          <SidebarContent onClose={() => useStore.setState({ drawerOpen: false })} />
        </aside>
      </>
    );
  }
  if (!open) return <Rail />;
  return (
    <aside className="glass-strong z-20 flex w-72 shrink-0 flex-col border-r border-white/[0.06]">
      <SidebarContent />
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
