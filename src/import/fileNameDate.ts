// Phones and chat apps put the capture date in the file name, e.g. IMG-20240512-WA0003.jpg,
// PXL_20240512_093015123.jpg, Screenshot_2024-05-12-09-30-15.png. Chat apps strip EXIF, so this
// is often the only real date left. A trailing millisecond part (PXL_…_093015123) is allowed and ignored.
const DATE_RE =
  /(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[-_ .T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})(?:[-_.]?\d{1,3})?)?(?!\d)/g;
// Epoch milliseconds, e.g. FB_IMG_1715506215000.jpg (years 2001–2033).
const EPOCH_MS_RE = /(?<!\d)1\d{12}(?!\d)/;

const MIN_YEAR = 1990;

/**
 * Capture time encoded in a photo's file name, in the device's local time (the same convention as
 * EXIF DateTimeOriginal). Names with a date but no time are placed at noon.
 */
export function dateFromFileName(name: string): number | undefined {
  return timeFromFileName(name)?.t;
}

/** Like dateFromFileName, but also says whether the name carried a time of day or only a date. */
export function timeFromFileName(name: string): { t: number; hasTime: boolean } | undefined {
  const epoch = name.match(EPOCH_MS_RE);
  if (epoch) return { t: Number(epoch[0]), hasTime: true };
  for (const m of name.matchAll(DATE_RE)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const hasTime = m[4] != null;
    const [h, mi, s] = hasTime ? [Number(m[4]), Number(m[5]), Number(m[6])] : [12, 0, 0];
    if (y < MIN_YEAR || y > new Date().getFullYear() + 1 || h > 23 || mi > 59 || s > 59) continue;
    const date = new Date(y, mo - 1, d, h, mi, s);
    // Reject impossible days like 20240231, which Date would roll into March.
    if (date.getMonth() !== mo - 1 || date.getDate() !== d) continue;
    return { t: date.getTime(), hasTime };
  }
  return undefined;
}
