# To do

## Decision: where the live-satellites page gets its orbit data

**Status:** open. The page currently downloads CelesTrak's Starlink GP data straight from each visitor's browser.

**Problem:**
- CelesTrak allows one download of the Starlink list per internet connection per 2-hour update and answers `403` to repeats. Several devices on one network (for example a family at the cottage) or a cleared cache can hit that limit; the page then shows "Try again in up to 2 hours".
- CelesTrak's [usage policy](https://celestrak.org/usage-policy.php) also discourages serving many visitors directly. It asks sites with many users to run their own caching proxy.

**Sources checked (2026-10-02):**

| Source | All of Starlink? | Browser access, no key? | Notes |
|---|---|---|---|
| CelesTrak GP (current) | Yes, ~11,100 | Yes | One download per connection per 2 h |
| [CelesTrak SupGP](https://celestrak.org/NORAD/elements/supplemental/) (`sup-gp.php?FILE=starlink&FORMAT=json`) | Yes, ~11,150 | Yes | Built from SpaceX's own predictions; about 10× more accurate than GP. Same limit, but counted separately |
| [SpaceX ephemerides](https://api.starlink.com/public-files/ephemerides/README.md) | Yes | No CORS | ~2 MB per satellite (72 h of 1-minute positions), ~22 GB per update. Not usable on a website |
| [tle.ivanstanojevic.me](https://tle.ivanstanojevic.me/) | Yes, ~12,350 | Yes | Max 100 per page, so 124 requests per load. Copied from CelesTrak and about a day older |
| [KeepTrack API](https://keeptrack.space/api) | Yes | Needs a key | The key would be visible in the browser; CC BY-NC licence |
| Space-Track | Yes | Login, no CORS | Redistribution is restricted |
| SatNOGS | No, only 6 | No CORS | Not usable |

**Options:**

1. **Shared cache built with GitHub Actions** (recommended; free, no card).
   - A scheduled workflow downloads CelesTrak every 2–6 h (SupGP first, GP as backup) and keeps only the fields the app needs.
   - It force-pushes the result to a `data` branch; the app reads it from `raw.githubusercontent.com`, which allows browser access (`Access-Control-Allow-Origin: *`) and caches for 5 minutes.
   - CelesTrak sees one download per update, and visitors can never hit the limit.
   - Daily snapshots could also be kept, for rewind beyond ±3 days.
   - Risks: GitHub's job machines share IP addresses, so CelesTrak may occasionally refuse a run (the site then keeps the previous snapshot). GitHub pauses scheduled workflows after 60 days without repo activity.
2. **Cloudflare Worker with a cron trigger and KV storage** (free tier, no card).
   - Same idea, but it has the same shared-IP risk.
   - The 10 ms CPU limit rules out slimming the data.
   - KV allows 1 GB and 1,000 writes a day.
   - Avoid R2: it needs a card on file.
3. **Client fallback** (small change, works alongside 1 or 2): if the shared copy can't be reached, download from CelesTrak directly, trying SupGP before GP.
4. **Keep as is:** browser downloads with a 2-hour cache and backoff on `403`.
