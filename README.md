# Starlink Sky Check (Norway)

A static web app that estimates how much of a Starlink dish's field of view would be blocked by hills, trees and buildings at any spot in Norway. It uses Kartverket's national laser elevation data. There is no backend: everything runs in the browser.

## How it works

1. **Place a spot.** Search an address or click the map, then set the antenna height above ground.
2. **Download elevation data.** The app fetches two GeoTIFF tiles from Kartverket's WCS (about 8 MB in total):
   - **Near tile:** ±500 m at 1 m resolution. It uses the surface model (DOM, trees and buildings), or the terrain model (DTM) if trees are switched off.
   - **Far tile:** ±10 km at 20 m resolution, always from the terrain model.
   - **Extended tile, only when needed:** ±50 km at 100 m (about 4 MB more). The app works out how far away Norway's highest mountain (2,470 m) could still rise into the dish's view, given the antenna's height above sea level and the lowest part of the dish's view, including Earth curvature. It fetches this tile only when that distance is beyond 10 km. That's the case, for example, for Flat High Performance near sea level, or a strongly tilted dish. Re-aiming the dish re-checks this automatically.
3. **Compute the horizon.** The ground height comes from Kartverket's point API, and the antenna sits at ground height plus the antenna height.
   - The app casts 1,440 rays (one every 0.25°) and records the highest elevation angle along each. It corrects for Earth curvature and refraction.
   - Azimuths are true north; the UTM33 grid's meridian convergence is corrected for.
   - Cells within 8 m of the antenna are ignored so the house doesn't block itself.
4. **Compare against the dish cone.** The cone is centred on the dish's aim (azimuth, tilt from vertical) and is as wide as the kit's field of view: 110° for Standard and Mini, 140° for Flat High Performance. The result is the **% of the cone's solid angle that lies below the horizon**.
5. **Show the result:** a polar sky plot (zenith in the centre, north up), plus a map overlay with four styles to choose from in the map's top-left corner:
   - **Fan + ring** (default): translucent red wedges from the antenna out to each blocking obstacle, and a ring of constant on-screen size around the antenna coloured per direction (green = clear, red = blocked, grey = outside the dish's view).
   - **Horizon area:** the full horizon outline filled in the spot's colour, with blocked sightlines in red. Its outline is spiky, because neighbouring directions can be limited by a tree a few metres away or by a ridge kilometres away.
   - **Ring:** only the direction ring.
   - **All:** fan + ring + the full horizon line.

Spots, settings, the selected spot and the overlay style are stored in the URL, so **Copy link** shares the exact view.

## Limitations

- **Trees** are as they were when the area was laser-scanned.
- **Starlink** gives no published dish tilt or azimuth for Norway. The defaults (facing north, 20° tilt) are a starting point; the Starlink app tells you the real values after setup.
- **The metric** is purely geometric. It doesn't weight by where satellites actually are, and Starlink says obstructions low in the sky matter more.
- **Data gaps:** sea and areas outside Kartverket's coverage come back as about 0 m. The app warns when the ground height at the spot is about 0.
- **Reach:** terrain beyond 50 km is never fetched. The results panel lists what each analysis covers and warns when the dish aim dips so low that terrain further away could matter.
- **Nearby objects:** anything within the "ignore objects closer than" distance (8 m by default) is skipped, so the house itself doesn't count as an obstruction. Lower it if trees stand right next to the house, or they will be missed.

## Data sources

All are CORS-enabled and need no key:

| Purpose | Endpoint |
| --- | --- |
| Surface model (DOM) | `https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833` (WCS 1.0.0, `format=GeoTIFF`) |
| Terrain model (DTM) | `https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` |
| Point height | `https://ws.geonorge.no/hoydedata/v1/punkt` |
| Address search | `https://ws.geonorge.no/adresser/v1/sok` |
| Basemap | `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png` |

Data © Kartverket, CC BY 4.0.

## Development

```bash
npm install
npm start          # http://localhost:4200
npm test           # unit tests (Vitest)
npm run build      # production build -> dist/starlink-simulator/browser
```

The code is laid out as follows:

- `src/app/analysis/` holds the pure horizon and cone maths, with unit tests.
- `src/app/core/` holds the Kartverket clients, projections and kit templates.
- `src/app/state/` holds the signal store, the analysis orchestration and the URL codec.
- `src/app/components/` holds the UI.

MapLibre 6 loads its web worker as a separate module, so `angular.json` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` to `/maplibre/`, and `map-view.ts` points `setWorkerUrl` at them.

## Deploying to Cloudflare Pages

- **Build command:** `npm run build`
- **Output directory:** `dist/starlink-simulator/browser`

Either connect the Git repository in the Cloudflare dashboard, or deploy from the command line with `npx wrangler pages deploy dist/starlink-simulator/browser --project-name starlink-sky-check`. `public/_headers` sets the cache headers.
