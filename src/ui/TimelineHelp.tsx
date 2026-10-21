/** How to get a Timeline export. Google moved Timeline onto phones in 2024, so it is no longer in Takeout for most people. */
export function TimelineHelp() {
  return (
    <details className="mt-3 text-xs leading-relaxed text-slate-400">
      <summary className="cursor-pointer text-slate-300">How do I export my Timeline?</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          <b className="text-slate-300">Android:</b> Settings → Location → Location services → Timeline → Export Timeline data. Send the file to this device.
        </li>
        <li>
          <b className="text-slate-300">iPhone:</b> Google Maps → your profile picture → Settings → Personal content → Export Timeline data.
        </li>
        <li>
          <b className="text-slate-300">Older Takeout exports</b> work too: <code>Records.json</code> or the monthly files in <code>Semantic Location History</code> (pick several at once).
        </li>
      </ul>
    </details>
  );
}
