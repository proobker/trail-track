// Downloads named hiking routes in Nepal from OpenStreetMap (Overpass) and writes a compact copy the
// app bundles for trek matching: `npm run treks:update`. Data © OpenStreetMap contributors, ODbL.
import { writeFileSync } from 'node:fs';

const OUT = new URL('../src/trail/osmTreks.json', import.meta.url);
const LIST_QUERY = `[out:json][timeout:180];
area["ISO3166-1"="NP"][admin_level=2]->.np;
relation["route"~"^(hiking|foot)$"]["name"](area.np);
out tags;`;
const geomQuery = (ids) => `[out:json][timeout:180];relation(id:${ids.join(',')});out geom;`;
/** Geometry for every route at once is too much for public servers; fetch a few at a time. */
const CHUNK = 15;
/** City walking/bus routes and summit climbs are not treks. */
const SKIP = /ratnapark|bus park|bagbazaar|tourist route|heritage walk|sadak|south col|north col|^珠穆朗玛/i;
/** Keep a point every ~1 km; enough to compare against photo stops. */
const STEP_M = 1000;

const metres = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

/** Keeps the first and last point and one roughly every STEP_M in between. */
function thin(line) {
  const out = [line[0]];
  let since = 0;
  for (let i = 1; i < line.length; i++) {
    since += metres(line[i - 1], line[i]);
    if (since >= STEP_M || i === line.length - 1) {
      out.push(line[i]);
      since = 0;
    }
  }
  return out;
}

/** "DHORPATAN TREK" → "Dhorpatan Trek", "Naar-Phu trek" → "Naar-Phu Trek"; other names keep OSM's casing. */
const tidy = (name) => {
  const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const n = name === name.toUpperCase() ? name.toLowerCase().split(' ').map(capital).join(' ') : capital(name);
  return n.replace(/\btrek\b/g, 'Trek').replace(/\s+/g, ' ').trim();
};

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/** Public Overpass servers are often busy: retry with exponential backoff, alternating servers. */
async function overpass(query) {
  let wait = 5_000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = SERVERS[attempt % SERVERS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'trail-track (treks:update)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) {
        const json = await res.json();
        // A query that ran out of time or memory still answers 200, with a remark and partial data.
        if (!json.remark) return json.elements;
        console.warn(`${url}: ${json.remark}, retrying in ${wait / 1000}s`);
      } else {
        console.warn(`${url}: ${res.status}, retrying in ${wait / 1000}s`);
      }
    } catch (e) {
      console.warn(`${url}: ${e.message}, retrying in ${wait / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error('Overpass is unavailable; try again later');
}

const listed = (await overpass(LIST_QUERY)).filter((el) => !SKIP.test(el.tags['name:en'] || el.tags.name || ''));
const elements = [];
for (let i = 0; i < listed.length; i += CHUNK) {
  elements.push(...(await overpass(geomQuery(listed.slice(i, i + CHUNK).map((el) => el.id)))));
  console.log(`Fetched ${Math.min(i + CHUNK, listed.length)} / ${listed.length} routes`);
}

const treks = [];
for (const el of elements) {
  const name = el.tags['name:en'] || el.tags.name;
  if (!name || SKIP.test(name)) continue;
  const lines = (el.members ?? [])
    .filter((m) => m.type === 'way' && m.geometry?.length > 1)
    .map((m) => thin(m.geometry.map((p) => [+p.lat.toFixed(4), +p.lon.toFixed(4)])));
  const points = lines.reduce((n, l) => n + l.length, 0);
  if (points < 2) continue;
  treks.push({ name: tidy(name), osmId: el.id, lines });
}
treks.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), treks }) + '\n');
console.log(`Wrote ${treks.length} treks to ${OUT.pathname}`);
