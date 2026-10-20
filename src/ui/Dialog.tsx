import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/** The app-wide confirm dialog, driven by `confirmDialog()` in the store. */
export function Dialog() {
  const req = useStore((s) => s.dialog);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && req.resolve(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && req.resolve(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" className="glass-strong pop-in w-full max-w-sm rounded-2xl p-5 shadow-2xl">
        <h2 id="dlg-title" className="font-display text-lg font-semibold text-white">
          {req.title}
        </h2>
        {req.body && <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{req.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => req.resolve(false)}>
            Cancel
          </button>
          <button ref={confirmRef} className={req.danger ? 'btn-danger' : 'btn-primary'} onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
