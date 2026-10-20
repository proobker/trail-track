import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A button that toggles a floating panel; closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  align = 'left',
  side = 'bottom',
  className = '',
  triggerClassName = '',
  label,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  side?: 'top' | 'bottom';
  className?: string;
  triggerClassName?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`glass-strong pop-in absolute z-40 rounded-xl p-1.5 shadow-2xl ${side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} ${align === 'left' ? 'left-0' : 'right-0'} ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition disabled:opacity-40 ${danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-200 hover:bg-white/10'}`}
    >
      {icon}
      {children}
    </button>
  );
}
