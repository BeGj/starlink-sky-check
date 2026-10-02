import type { OMMJsonObject } from 'satellite.js';

export type Omm = OMMJsonObject;

export const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json';
/** CelesTrak updates element sets about every 2 hours and asks clients not to fetch more often. */
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const CACHE_NAME = 'celestrak-v1';
const FETCHED_AT_HEADER = 'x-fetched-at';
/** When CelesTrak last refused a request; we don't ask again until MAX_AGE_MS has passed. */
const FAILURE_KEY = 'celestrak-failed-at';

/**
 * CelesTrak answers 403 when this connection already downloaded the current Starlink data (it updates every
 * 2 hours). That happens when the browser cache was cleared, or when several people share one internet connection.
 */
const RATE_LIMITED =
  'CelesTrak allows each internet connection to download the Starlink list once per update, every 2 hours, and this connection already has. Try again in up to 2 hours.';

export interface OrbitData {
  elements: Omm[];
  /** When the data was downloaded from CelesTrak (ms since epoch). */
  fetchedAt: number;
  /** Set when fresh data couldn't be fetched and older cached data is used instead. */
  notice?: string;
}

/** Injected for tests; defaults to the browser's fetch, Cache API, localStorage and clock. */
export interface CelestrakDeps {
  fetch: typeof fetch;
  caches: CacheStorage | undefined;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  now: () => number;
}

function browserDeps(): CelestrakDeps {
  let storage: CelestrakDeps['storage'];
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    fetch: (...args) => fetch(...args),
    caches: typeof caches === 'undefined' ? undefined : caches,
    storage,
    now: () => Date.now(),
  };
}

/**
 * Starlink element sets from CelesTrak, cached in the browser for 2 hours so every visitor fetches at most
 * once per CelesTrak update. If CelesTrak refuses a request (rate limit, outage), cached data is used and
 * CelesTrak isn't asked again for 2 hours, as its usage policy requires.
 */
export async function loadStarlinkElements(deps: CelestrakDeps = browserDeps()): Promise<OrbitData> {
  const cache = await openCache(deps);
  const cached = await readCached(cache);
  const now = deps.now();
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) return cached;

  const failure = safeGet(deps, FAILURE_KEY);
  const failedAt = failure === null ? NaN : Number(failure);
  if (Number.isFinite(failedAt) && now - failedAt < MAX_AGE_MS) {
    if (cached) return { ...cached, notice: 'CelesTrak is not answering right now, so the orbit data may be a few hours old.' };
    throw new Error(RATE_LIMITED);
  }

  try {
    const res = await deps.fetch(CELESTRAK_URL);
    if (res.status === 403) throw new Error(RATE_LIMITED);
    if (!res.ok) throw new Error(`CelesTrak answered with an error (${res.status}). Try again later.`);
    const text = await res.text();
    const elements = parseElements(text);
    safeRemove(deps, FAILURE_KEY);
    await cache?.put(CELESTRAK_URL, new Response(text, { headers: { 'content-type': 'application/json', [FETCHED_AT_HEADER]: String(now) } }));
    return { elements, fetchedAt: now };
  } catch (err) {
    safeSet(deps, FAILURE_KEY, String(now));
    if (cached) return { ...cached, notice: 'Could not reach CelesTrak, so the orbit data may be a few hours old.' };
    throw err instanceof Error ? err : new Error('Could not download orbit data');
  }
}

function parseElements(text: string): Omm[] {
  const data: unknown = JSON.parse(text);
  // CelesTrak answers with a plain-text message (not JSON) for errors, and an empty array for unknown groups.
  if (!Array.isArray(data) || data.length === 0) throw new Error('CelesTrak returned no Starlink satellites');
  return data as Omm[];
}

async function openCache(deps: CelestrakDeps): Promise<Cache | undefined> {
  try {
    return await deps.caches?.open(CACHE_NAME);
  } catch {
    return undefined;
  }
}

async function readCached(cache: Cache | undefined): Promise<OrbitData | null> {
  try {
    const res = await cache?.match(CELESTRAK_URL);
    if (!res) return null;
    const fetchedAt = Number(res.headers.get(FETCHED_AT_HEADER));
    if (!Number.isFinite(fetchedAt)) return null;
    return { elements: parseElements(await res.text()), fetchedAt };
  } catch {
    return null;
  }
}

function safeGet(deps: CelestrakDeps, key: string): string | null {
  try {
    return deps.storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(deps: CelestrakDeps, key: string, value: string): void {
  try {
    deps.storage?.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the backoff then only lasts for this page load.
  }
}

function safeRemove(deps: CelestrakDeps, key: string): void {
  try {
    deps.storage?.removeItem(key);
  } catch {
    // See safeSet.
  }
}
