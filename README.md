# Starlink Sky Check (Norway)

A static web app that estimates how much of a Starlink dish's field of view would be blocked by hills, trees and buildings at any spot in Norway. It uses Kartverket's national laser elevation data. There is no backend: everything runs in the browser.

**Try it: [starlink.schjem.net](https://starlink.schjem.net)**

## How it works

1. **Place a spot.** Search an address or click the map, then set the antenna height above ground.
2. **Download elevation data.** The app fetches two GeoTIFF tiles from Kartverket's WCS (about 8 MB in total):
   - **Near tile:** ±500 m at 1 m resolution. It uses the surface model (DOM, trees and buildings), or the terrain model (DTM) if trees are switched off.
   - **Far tile:** ±10 km at 20 m resolution, always from the terrain model.
   - **Extended tile, only when needed:** ±50 km at 100 m (about 4 MB more). The app works out how far away Norway's highest mountain (2,470 m) could still rise into the dish's view, given the antenna's height above sea level and the lowest part of the dish's view, including Earth curvature. It fetches this tile only when that distance is beyond 10 km. At the default 25° lowest satellite elevation that never happens (the distance is at most about 5 km). It takes a minimum below about 14° and a dish view that reaches that low, for example a 140° kit near sea level with the minimum at 0°. Re-aiming the dish re-checks this automatically.
3. **Compute the horizon.** The ground height comes from Kartverket's point API, and the antenna sits at ground height plus the antenna height.
   - The app casts 1,440 rays (one every 0.25°) and records the highest elevation angle along each. It corrects for Earth curvature and refraction.
   - Azimuths are true north; the UTM33 grid's meridian convergence is corrected for.
   - Cells within 8 m of the antenna are ignored so the house doesn't block itself.
4. **Compare against the dish cone.** The cone is centred on the dish's aim (azimuth, tilt from vertical) and is as wide as the kit's field of view, from Starlink's spec sheets: 110° for Standard and Mini, 140° for Performance (Gen 3) and the older Flat High Performance.
   - Only sky above the **lowest satellite elevation** counts (default 25°, adjustable). Starlink has long only used satellites at least 25° above the horizon. In 2026 the US regulator (FCC) allowed lower angles: 20°, or 10° for very low satellites, and 5° north of 62°N. It isn't known whether that applies in Norway. Set it to 0 to count the whole cone.
   - The main result is the **% of the usable cone's solid angle that lies below the horizon**.
   - A second, **weighted %** counts each part of the sky by how many satellites appear there, assuming they are spread evenly over a 550 km shell. Low sky holds more satellites (about 7× the zenith at 25°), which matches Starlink's advice that low obstructions matter more. Real shells are uneven in latitude, so this is an estimate.
   - A **rough rating** from the weighted %: under 5% good, 5–10% some problems, over 10% serious problems. These are thresholds Starlink users commonly report, not official figures.
5. **Show the result:** a polar sky plot (zenith in the centre, north up), plus a map overlay with four styles to choose from in the map's top-left corner:
   - **Fan + ring** (default): translucent red wedges from the antenna out to each blocking obstacle, and a ring of constant on-screen size around the antenna coloured per direction (green = clear, red = blocked, grey = outside the dish's view).
   - **Horizon area:** the full horizon outline filled in the spot's colour, with blocked sightlines in red. Its outline is spiky, because neighbouring directions can be limited by a tree a few metres away or by a ridge kilometres away.
   - **Ring:** only the direction ring.
   - **All:** fan + ring + the full horizon line.

Spots, settings, the selected spot and the overlay style are stored in the URL, so **Copy link** shares the exact view. Links made before the lowest-satellite-elevation setting existed open with the 25° default, so their numbers may differ from when they were shared.

## 3D view

The **3D** button in the map's top-left corner tilts the map and turns on terrain. Right-drag (or a two-finger drag on a phone) tilts and turns it. The overlays and markers sit on the terrain.

- **Terrain source:** the same Kartverket laser data. Kartverket's WCS reprojects 256 px tiles to web mercator on the server. A custom `kvdem://` MapLibre protocol (`src/app/core/dem-protocol.ts`) re-encodes them as Terrarium PNGs in the browser.
- **Detail:** MapLibre builds its 3D mesh from elevation tiles one zoom level below the view, with 128 mesh cells per 256 px tile, so each mesh cell spans 2 elevation pixels.
  - **Standard** uses tiles up to z15: about a 4.8 m mesh (2.4 m hillshade) at 60°N. Trees show as soft bumps.
  - **HQ** (button next to 3D) uses tiles up to z17: about a 1.2 m mesh, close to the 1 m resolution of the laser data. Individual trees and building outlines show. Tiles up to z15 are shared between the two levels.
- **Antenna:** each spot gets a mast with a dish on top, at the altitude the analysis used (ground + antenna height above ground). With trees and buildings on, the surface under the spot may be a roof, so the visible mast can be shorter than the height above ground. The dish is drawn a bit larger than a real one so it's visible.
- **Surface:** follows the selected spot's tree setting. Trees on uses the surface model with trees and buildings; trees off uses bare ground.
- **Hillshade:** computed from the same data and drawn over the topo map, so tree canopies and roofs show up as relief.
- **Data cost:** about 0.25 MB per elevation tile. A typical close-up view loads 20–30 tiles at standard detail. In HQ, a street-level view in Bergen loaded 33 tiles (about 9 MB), and panning loads more. The terrain and hillshade layers share each download, and at most 6 requests are sent to Kartverket at once.
- **Shareable link:** the 3D state is saved in the URL as `3d=1`, or `3d=hq` for high detail.

## Limitations

- **Trees** are as they were when the area was laser-scanned.
- **Starlink** gives no published dish tilt or azimuth for Norway. The defaults (facing north, 20° tilt) are a starting point; the Starlink app tells you the real values after setup. Northern-hemisphere dishes face roughly north because Starlink avoids the part of the sky towards the equator where geostationary satellites are.
- **Kit tilts:** Standard's 20° matches its kickstand. Performance (Gen 3)'s 20° is a placeholder, since Starlink publishes no default. Flat High Performance sits at about 8° on the Wedge Mount and about 2° on the Flat Mount.
- **The metrics** are geometric. The main % doesn't weight by where satellites are; the weighted % assumes they are spread evenly around the Earth, which they aren't, especially this far north. Neither is the time-based figure the Starlink app reports.
- **Lowest satellite elevation** defaults to 25°. If Starlink uses lower angles in Norway, the real dish can see (and be blocked by) more of the low sky than the default counts.
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

## Deployment

The app is hosted on Cloudflare Pages as the project `starlink-sky-check`, connected to this GitHub repository, and served at [starlink.schjem.net](https://starlink.schjem.net).

- **Production:** every push to `main` builds and deploys to `starlink.schjem.net` (also `starlink-sky-check.pages.dev`).
- **Previews:** pushes to other branches and pull requests get their own preview URL on `*.starlink-sky-check.pages.dev`, posted as a comment on the PR.
- **Build command:** `npm run build`
- **Output directory:** `dist/starlink-simulator/browser`
- **Node version:** the build sets the environment variable `NODE_VERSION=24.15.0`. The `packageManager` field pins npm 12, which needs Node `^22.22.2 || ^24.15.0 || >=26`, and the build image's default Node is too old for it. If you change `packageManager`, update `NODE_VERSION` to match.
- **Custom domain:** `starlink.schjem.net` is a proxied CNAME to `starlink-sky-check.pages.dev` in the `schjem.net` Cloudflare zone.
- **Headers:** `public/_headers` sets the security and cache headers.

The project can be inspected with the `cf` CLI (set `CLOUDFLARE_ACCOUNT_ID` to the account that owns `schjem.net`):

```bash
cf pages deployments list --project-name starlink-sky-check
cf pages domains get starlink.schjem.net --project-name starlink-sky-check
```

To deploy a local build by hand instead of pushing: `npx wrangler pages deploy dist/starlink-simulator/browser --project-name starlink-sky-check`.
