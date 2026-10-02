/**
 * Cesium ion access token (free tier, non-commercial) for Bing imagery and Cesium World Terrain.
 * It's sent from the browser, so it's public by design; restrict it to the site's domains
 * (starlink.schjem.net, *.starlink-sky-check.pages.dev, localhost) in the Cesium ion dashboard.
 * Leave empty to run without ion: Natural Earth imagery, Kartverket topo over Norway, open terrain elsewhere.
 */
export const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6InZBZ3MzOVViVTlfZk1JYWIiLCJqdGkiOiJlYjgwNGUyMi0zYzQ1LTQxZDItOTA4NC1iNDEwZGZjMWI2ODUiLCJpZCI6OTEzNjgsInN1YiI6IlBldGVyc2MiLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoic3RhcmxpbmsiLCJpYXQiOjE3OTA5ODE2Njd9.zqRWgPUEpbToZPlQjhNztRK87ddpfdrDMoRCgdgAxFE';

let ionCheck: Promise<boolean> | null = null;

/**
 * Whether the ion token works (checked once per page load against Bing Aerial, asset 2). A missing, revoked or
 * over-quota token makes the sky view fall back to imagery and terrain that don't need ion.
 */
export function ionAvailable(): Promise<boolean> {
  if (!CESIUM_ION_TOKEN) return Promise.resolve(false);
  ionCheck ??= fetch(`https://api.cesium.com/v1/assets/2/endpoint?access_token=${encodeURIComponent(CESIUM_ION_TOKEN)}`)
    .then((res) => res.ok)
    .catch(() => false);
  return ionCheck;
}
