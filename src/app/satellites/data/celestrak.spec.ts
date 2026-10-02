import { CELESTRAK_URL, CelestrakDeps, loadStarlinkElements, MAX_AGE_MS } from './celestrak';

const SAMPLE = JSON.stringify([{ OBJECT_NAME: 'STARLINK-1', NORAD_CAT_ID: 1 }]);
const NEWER = JSON.stringify([{ OBJECT_NAME: 'STARLINK-1', NORAD_CAT_ID: 1 }, { OBJECT_NAME: 'STARLINK-2', NORAD_CAT_ID: 2 }]);

/** In-memory stand-ins for the Cache API and localStorage. */
function fakeDeps(now: number, responses: (() => Response)[]) {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, res: Response) => void store.set(url, res.clone()),
  } as unknown as Cache;
  const storage = new Map<string, string>();
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('network down');
    return next();
  });
  const deps: CelestrakDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    caches: { open: async () => cache } as unknown as CacheStorage,
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    },
    now: () => now,
  };
  return { deps, fetch, store, setNow: (t: number) => (now = t) };
}

describe('loadStarlinkElements', () => {
  it('downloads once and serves the cache for 2 hours', async () => {
    const f = fakeDeps(1_000_000, [() => new Response(SAMPLE), () => new Response(NEWER)]);
    const first = await loadStarlinkElements(f.deps);
    expect(first.elements).toHaveLength(1);
    expect(f.fetch).toHaveBeenCalledWith(CELESTRAK_URL);

    f.setNow(1_000_000 + MAX_AGE_MS - 1);
    const cached = await loadStarlinkElements(f.deps);
    expect(cached.elements).toHaveLength(1);
    expect(cached.fetchedAt).toBe(1_000_000);
    expect(f.fetch).toHaveBeenCalledTimes(1);

    f.setNow(1_000_000 + MAX_AGE_MS + 1);
    const fresh = await loadStarlinkElements(f.deps);
    expect(fresh.elements).toHaveLength(2);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to cached data and backs off when CelesTrak refuses', async () => {
    const f = fakeDeps(0, [() => new Response(SAMPLE), () => new Response('Too many requests', { status: 403 })]);
    await loadStarlinkElements(f.deps);

    f.setNow(MAX_AGE_MS + 10);
    const fallback = await loadStarlinkElements(f.deps);
    expect(fallback.elements).toHaveLength(1);
    expect(fallback.notice).toBeTruthy();
    expect(f.fetch).toHaveBeenCalledTimes(2);

    // Within 2 hours of the refusal, CelesTrak isn't asked again.
    f.setNow(MAX_AGE_MS + 20 + MAX_AGE_MS / 2);
    await loadStarlinkElements(f.deps);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails clearly without cached data', async () => {
    const f = fakeDeps(0, [() => new Response('Invalid query', { status: 200 })]);
    await expect(loadStarlinkElements(f.deps)).rejects.toThrow();
    // The failure starts the backoff, so an immediate retry doesn't hit CelesTrak.
    await expect(loadStarlinkElements(f.deps)).rejects.toThrow(/once per update/);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
