import type { Omm } from './data/celestrak';

/** Starlink's orbital shells by inclination, with a colour each for the maps and the legend. */
export const SHELLS = [
  { label: '53° shells', inclination: 53.1, color: '#1d4ed8' },
  { label: '43° shells', inclination: 43, color: '#7c3aed' },
  { label: '70° shell', inclination: 70, color: '#c2410c' },
  { label: '97.6° polar shell', inclination: 97.6, color: '#047857' },
] as const;

/** Index into SHELLS for an element set, or -1 (other: raising, deorbiting or test orbits). */
export function shellOf(e: Pick<Omm, 'INCLINATION'>): number {
  const inc = Number(e.INCLINATION);
  return SHELLS.findIndex((s) => Math.abs(inc - s.inclination) < 1.5);
}
