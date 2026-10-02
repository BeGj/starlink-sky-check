import type { Omm } from './data/celestrak';
import type { Observer } from './orbit-math';

/** Messages between the satellites page and orbit.worker.ts. */
export type WorkerRequest =
  | { type: 'init'; elements: Omm[] }
  | { type: 'propagate'; id: number; time: number; observer: Observer | null }
  | { type: 'track'; id: number; index: number; from: number; to: number; stepMs: number };

export type WorkerResponse =
  | { type: 'ready'; valid: number }
  | { type: 'positions'; id: number; time: number; geo: Float32Array; look: Float32Array | null }
  | { type: 'track'; id: number; index: number; track: Float32Array };
