import { loadStarlinkElements, OrbitData } from './celestrak';

/**
 * Where element sets come from. The client-only source returns the latest set for any time and lets
 * SGP4 propagate it backwards and forwards; an archive source could return the snapshot nearest `time`.
 */
export interface OrbitSource {
  /** Furthest the sim time may move from now (ms) with this source's data. */
  readonly maxOffsetMs: number;
  elementsFor(time: Date): Promise<OrbitData>;
}

/** Latest CelesTrak elements, propagated up to 3 days either way. */
export class CelestrakSource implements OrbitSource {
  readonly maxOffsetMs = 72 * 60 * 60 * 1000;

  elementsFor(): Promise<OrbitData> {
    return loadStarlinkElements();
  }
}
