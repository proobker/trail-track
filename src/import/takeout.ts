import { BlobReader, BlobWriter, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { uid } from '../model/types';
import type { PhotoCandidate } from './candidate';
import { matchImageName, parseSidecar } from './takeoutSidecar';

interface Item {
  path: string;
  readText: () => Promise<string>;
  readBlob: () => Promise<Blob>;
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

async function itemsFromZip(file: File): Promise<Item[]> {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  return entries
    .filter((e): e is FileEntry => !e.directory)
    .map((e) => ({
      path: e.filename,
      readText: () => e.getData(new TextWriter()),
      readBlob: () => e.getData(new BlobWriter()),
    }));
}

function itemFromFile(file: File): Item {
  return { path: file.webkitRelativePath || file.name, readText: () => file.text(), readBlob: async () => file };
}

/**
 * Scans Takeout zips and/or an extracted Takeout folder. Only the small sidecar JSONs are
 * read here; images are read later via `getBlob` for the photos the user keeps.
 */
export async function scanTakeout(files: File[], onProgress?: (msg: string) => void): Promise<PhotoCandidate[]> {
  const items: Item[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      onProgress?.(`Reading ${f.name}…`);
      items.push(...(await itemsFromZip(f)));
    } else {
      items.push(itemFromFile(f));
    }
  }
  // Split zips put a photo and its sidecar in different archives, so index by folder across all inputs.
  const byDir = new Map<string, Map<string, Item>>();
  for (const it of items) {
    const d = dirOf(it.path);
    if (!byDir.has(d)) byDir.set(d, new Map());
    byDir.get(d)!.set(nameOf(it.path), it);
  }

  const out: PhotoCandidate[] = [];
  const seen = new Set<string>();
  const jsons = items.filter((it) => it.path.toLowerCase().endsWith('.json'));
  let n = 0;
  for (const j of jsons) {
    if (++n % 250 === 0) onProgress?.(`Read ${n} / ${jsons.length} metadata files`);
    let info;
    try {
      info = parseSidecar(JSON.parse(await j.readText()));
    } catch {
      continue;
    }
    if (!info) continue;
    const siblings = byDir.get(dirOf(j.path))!;
    const imageName = matchImageName(nameOf(j.path), info.title, new Set(siblings.keys()));
    // The same photo appears in year folders and album folders; keep it once.
    const dedupeKey = `${info.title ?? imageName}|${info.takenAt}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const image = imageName ? siblings.get(imageName) : undefined;
    out.push({
      photo: {
        id: uid(),
        source: 'takeout',
        takenAt: info.takenAt,
        lat: info.lat,
        lng: info.lng,
        locationSource: info.locationSource,
        originalLocation: info.lat != null && info.lng != null ? { lat: info.lat, lng: info.lng } : undefined,
        people: info.people,
        fileName: imageName ?? info.title ?? nameOf(j.path),
        folder: info.folder,
      },
      getBlob: image?.readBlob,
    });
  }
  onProgress?.(`Found ${out.length} photos`);
  return out;
}
