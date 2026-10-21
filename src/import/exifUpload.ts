import exifr from 'exifr';
import { uid } from '../model/types';
import type { PhotoCandidate } from './candidate';
import { dateFromFileName } from './fileNameDate';

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|avif)$/i;

/** "+05:45" → 345. */
const offsetMinutes = (v: unknown) => {
  const m = typeof v === 'string' ? v.match(/^([+-])(\d{2}):?(\d{2})$/) : null;
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : undefined;
};

export async function scanUploads(files: File[]): Promise<PhotoCandidate[]> {
  const images = files.filter((f) => f.type.startsWith('image/') || IMAGE_RE.test(f.name));
  return Promise.all(
    images.map(async (file) => {
      let lat: number | undefined;
      let lng: number | undefined;
      let locationAccuracyM: number | undefined;
      // Without EXIF, the file time is usually when the photo was downloaded, so prefer a date in the name.
      const fromName = dateFromFileName(file.name);
      let takenAt = fromName ?? file.lastModified;
      let wallClock = fromName != null;
      try {
        // Pick raw GPS tags: latitude/longitude are computed outputs, not selectable EXIF tags.
        const tags = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime', 'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSHPositioningError'] });
        if (tags && Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude)) {
          lat = tags.latitude;
          lng = tags.longitude;
          if (Number.isFinite(tags.GPSHPositioningError) && tags.GPSHPositioningError > 0) locationAccuracyM = tags.GPSHPositioningError;
        }
        const date: Date | undefined = tags?.DateTimeOriginal ?? tags?.CreateDate;
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          // exifr reads the camera's clock time as if it were in this browser's zone; the offset tag gives the real one.
          const off = offsetMinutes(tags.OffsetTimeOriginal ?? tags.OffsetTime);
          const wall = date.getTime() - date.getTimezoneOffset() * 60_000;
          takenAt = off != null ? wall - off * 60_000 : date.getTime();
          wallClock = off == null;
        }
      } catch {
        // No readable EXIF: keep the file-name or file time and no location.
      }
      return {
        photo: { id: uid(), source: 'upload' as const, takenAt, wallClock: wallClock || undefined, lat, lng, locationSource: lat != null && lng != null ? 'exif' as const : undefined, locationAccuracyM, locationAccuracyLevel: locationAccuracyM != null ? 'unspecified' as const : undefined, originalLocation: lat != null && lng != null ? { lat, lng } : undefined, people: [], fileName: file.name },
        getBlob: async () => file,
      };
    }),
  );
}
