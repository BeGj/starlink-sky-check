/// <reference lib="webworker" />
import type { SatRec } from 'satellite.js';
import { buildSatrecs, groundTrack, propagateAll } from './orbit-math';
import type { WorkerRequest, WorkerResponse } from './orbit-messages';

let satrecs: (SatRec | null)[] = [];

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  switch (data.type) {
    case 'init': {
      satrecs = buildSatrecs(data.elements);
      reply({ type: 'ready', valid: satrecs.filter(Boolean).length });
      break;
    }
    case 'propagate': {
      const { geo, look } = propagateAll(satrecs, new Date(data.time), data.observer ?? undefined);
      reply({ type: 'positions', id: data.id, time: data.time, geo, look }, look ? [geo.buffer, look.buffer] : [geo.buffer]);
      break;
    }
    case 'track': {
      const rec = satrecs[data.index];
      const track = rec ? groundTrack(rec, data.from, data.to, data.stepMs) : new Float32Array(0);
      reply({ type: 'track', id: data.id, index: data.index, track }, [track.buffer]);
      break;
    }
  }
});

function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  postMessage(message, transfer);
}
