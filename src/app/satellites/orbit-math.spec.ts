import type { Omm } from './data/celestrak';
import { buildSatrecs, coverageRadius, groundTrack, orbitalPeriodMs, propagateAll, splitAtAntimeridian } from './orbit-math';

const STARLINK_1008 = {
  OBJECT_NAME: 'STARLINK-1008',
  OBJECT_ID: '2019-074B',
  EPOCH: '2026-10-02T06:16:12.775872',
  MEAN_MOTION: 15.65852398,
  ECCENTRICITY: 0.00028407,
  INCLINATION: 53.1459,
  RA_OF_ASC_NODE: 269.3715,
  ARG_OF_PERICENTER: 86.8425,
  MEAN_ANOMALY: 273.2916,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 44714,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 38091,
  BSTAR: 0.00027630371,
  MEAN_MOTION_DOT: 0.00028142,
  MEAN_MOTION_DDOT: 0,
} as unknown as Omm;
const EPOCH = Date.parse('2026-10-02T06:16:12.775Z');

describe('orbit-math', () => {
  const satrecs = buildSatrecs([STARLINK_1008, { OBJECT_NAME: 'broken' } as unknown as Omm]);

  it('builds records and marks unparseable element sets as null', () => {
    expect(satrecs[0]).not.toBeNull();
    expect(satrecs[1]).toBeNull();
  });

  it('propagates to a Starlink altitude and leaves failures as NaN', () => {
    const { geo, look } = propagateAll(satrecs, new Date(EPOCH + 3_600_000));
    // This satellite has been lowered to about 380 km (mean motion 15.66 rev/day).
    expect(geo[2]).toBeGreaterThan(300);
    expect(geo[2]).toBeLessThan(600);
    expect(Math.abs(geo[1])).toBeLessThanOrEqual(53.2);
    expect(geo[3]).toBeNaN();
    expect(look).toBeNull();
  });

  it('sees the satellite at the zenith from directly below it', () => {
    const date = new Date(EPOCH + 1_800_000);
    const { geo } = propagateAll(satrecs, date);
    const below = { lon: geo[0], lat: geo[1], height: 0 };
    const { look } = propagateAll(satrecs, date, below);
    expect(look![1]).toBeGreaterThan(89.5);
    expect(Math.abs(look![2] - geo[2])).toBeLessThan(2);
  });

  it('puts a satellite on the far side of the Earth below the horizon', () => {
    const date = new Date(EPOCH);
    const { geo } = propagateAll(satrecs, date);
    const opposite = { lon: geo[0] + 180, lat: -geo[1], height: 0 };
    const { look } = propagateAll(satrecs, date, opposite);
    expect(look![1]).toBeLessThan(-60);
  });

  it('traces a ground track across one orbit', () => {
    const period = orbitalPeriodMs(STARLINK_1008);
    expect(period / 60_000).toBeCloseTo(91.96, 1);
    const track = groundTrack(satrecs[0]!, EPOCH, EPOCH + period, 60_000);
    expect(track.length / 2).toBe(Math.floor(period / 60_000) + 1);
    const lats = Array.from({ length: track.length / 2 }, (_, k) => track[k * 2 + 1]);
    expect(Math.max(...lats)).toBeGreaterThan(50);
    expect(Math.min(...lats)).toBeLessThan(-50);
  });

  it('computes the coverage radius for a minimum elevation', () => {
    expect(coverageRadius(500, 90)).toBeCloseTo(0, 3);
    // Satellite at 500 km seen 25° up: about 870 km away along the ground.
    expect(coverageRadius(500, 25) / 1000).toBeGreaterThan(850);
    expect(coverageRadius(500, 25) / 1000).toBeLessThan(900);
    expect(coverageRadius(500, 0)).toBeGreaterThan(coverageRadius(500, 25));
  });

  it('splits tracks at the antimeridian and at gaps', () => {
    const track = new Float32Array([170, 0, 179, 1, -179, 2, -170, 3, NaN, NaN, 10, 4, 11, 5]);
    const parts = splitAtAntimeridian(track);
    expect(parts.map((p) => p.length)).toEqual([2, 2, 2]);
  });
});
