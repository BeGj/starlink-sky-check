/**
 * Splits ray indices 0..n-1 (a closed circle) into runs of consecutive included rays,
 * breaking wherever `joined(prev, k)` is false. A run that wraps past ray 0 stays in one piece.
 */
export function runs(n: number, include: (k: number) => boolean, joined: (prev: number, k: number) => boolean): number[][] {
  const isStart = (k: number) => include(k) && (!include((k - 1 + n) % n) || !joined((k - 1 + n) % n, k));
  let start = 0;
  while (start < n && !isStart(start)) start++;
  if (start === n) {
    // No run starts anywhere: either nothing is included, or the whole circle is one run.
    return include(0) ? [Array.from({ length: n }, (_, k) => k)] : [];
  }
  const out: number[][] = [];
  let run: number[] = [];
  for (let step = 0; step < n; step++) {
    const k = (start + step) % n;
    if (!include(k)) {
      if (run.length) out.push(run);
      run = [];
      continue;
    }
    if (run.length && !joined((k - 1 + n) % n, k)) {
      out.push(run);
      run = [];
    }
    run.push(k);
  }
  if (run.length) out.push(run);
  return out;
}
