import exifr from 'exifr';
import { uid } from '../model/types';
import type { PhotoCandidate } from './candidate';
import { dateFromFileName } from './fileNameDate';

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|avif)$/i;

export async function scanUploads(files: File[]): Promise<PhotoCandidate[]> {
  const images = files.filter((f) => f.type.startsWith('image/') || IMAGE_RE.test(f.name));
  return Promise.all(
    images.map(async (file) => {
      let lat: number | undefined;
      let lng: number | undefined;
      // Without EXIF, the file time is usually when the photo was downloaded, so prefer a date in the name.
      let takenAt = dateFromFileName(file.name) ?? file.lastModified;
      try {
        const tags = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] });
        if (tags && Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude)) {
          lat = tags.latitude;
          lng = tags.longitude;
        }
        const date: Date | undefined = tags?.DateTimeOriginal ?? tags?.CreateDate;
        if (date instanceof Date && !Number.isNaN(date.getTime())) takenAt = date.getTime();
      } catch {
        // No readable EXIF: keep the file-name or file time and no location.
      }
      return {
        photo: { id: uid(), source: 'upload' as const, takenAt, lat, lng, people: [], fileName: file.name },
        getBlob: async () => file,
      };
    }),
  );
}
