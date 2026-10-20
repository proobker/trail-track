# Trail Track

Turn your photos into an animated trail on a map. Filter by date and by who's in the photos, set how you travelled each leg, or draw and import routes yourself.

## Run

Requires Node.js 20+.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

## Where trails come from

| Source | Location | People filter | Notes |
| --- | --- | --- | --- |
| **Google Takeout** (zip or extracted folder) | ✅ from each photo's JSON sidecar | ✅ named faces | Best option. Export only "Google Photos" at [takeout.google.com](https://takeout.google.com). Split zips can be added together. Files are read locally and only matching photos are thumbnailed. |
| **Upload photos** | ✅ from EXIF GPS | — | Photos sent over chat apps usually have their location stripped. |
| **Google Photos picker** | ❌ | — | Google's Picker API removes GPS and offers no people filter. Picked photos are placed along an existing trail by timestamp, or you can pin them. |
| **KML / GPX / GeoJSON** | ✅ | — | Each track becomes a segment and keeps its exact shape. |
| **Manual** | — | — | Click the map in "Add stops" mode, or search for a place and press "+ stop". |

Google shut down full-library access to Google Photos in March 2025, which is why Takeout is the main import path.

## Editing a trail

- Each leg has its own transport mode. Walk, bike, car and bus follow real roads (OSRM). Flights are drawn as great-circle arcs. Train and boat use straight lines, or you can draw the path by hand.
- Modes are guessed from the speed between photos. Click an icon to change one.
- Drag stops while in "Add stops" mode. Reorder or rename them in the side panel.
- Photos without location show as dashed thumbnails. Pin each one on the map, or attach it to the stop nearest in time.
- Export as GPX, KML or GeoJSON. Use Back up / Restore to move everything, including thumbnails, to another browser.

## Playback

Press ▶ and the trail draws itself with a glowing line, a camera that follows along, and photo cards at each stop. You can change the speed, turn off camera follow, or press ● Rec to save the animation as a video. The recording captures the map canvas, so the HTML photo bubbles are not included.

## Google sign-in (optional)

Sign-in is only needed for the Google Photos picker.

1. Google Cloud Console → create a project → enable the **Google Photos Picker API**.
2. OAuth consent screen → add yourself as a test user.
3. Credentials → OAuth client ID → *Web application* → authorized JavaScript origin `http://localhost:5173`.
4. `cp .env.example .env` and set `VITE_GOOGLE_CLIENT_ID`.

## Privacy and services

Everything is stored in this browser (IndexedDB). Nothing is uploaded to a server. The app calls these third-party services:

- OpenFreeMap: map tiles
- Esri: satellite imagery
- AWS Terrain Tiles: 3D terrain
- Photon (komoot): place search
- routing.openstreetmap.de: OSRM routes; only the coordinates of each leg are sent

The public routing server is rate-limited, so routes are fetched about one per second and cached.
