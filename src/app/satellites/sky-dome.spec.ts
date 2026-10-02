import { domePositions, elevationRing } from './sky-dome';

describe('sky-dome', () => {
  const frame = { x: 0.5, y: 0.3, z: 0.001, unitsPerMetre: 1e-7 };
  const r = 30_000 * frame.unitsPerMetre;

  function place(az: number, el: number, minEl = 0): number[] {
    const out = new Float32Array(3);
    domePositions(new Float32Array([az, el, 1000]), frame, 30_000, minEl, out);
    return Array.from(out);
  }

  it('puts north at -y, east at +x and the zenith straight up', () => {
    const north = place(0, 0);
    expect(north[0]).toBeCloseTo(frame.x, 9);
    expect(north[1]).toBeCloseTo(frame.y - r, 6);
    expect(north[2]).toBeCloseTo(frame.z, 6);
    const east = place(90, 0);
    expect(east[0]).toBeCloseTo(frame.x + r, 6);
    const zenith = place(123, 90);
    expect(zenith[0]).toBeCloseTo(frame.x, 6);
    expect(zenith[1]).toBeCloseTo(frame.y, 6);
    expect(zenith[2]).toBeCloseTo(frame.z + r, 6);
  });

  it('keeps every point at the dome radius', () => {
    const p = place(200, 37);
    const d = Math.hypot(p[0] - frame.x, p[1] - frame.y, p[2] - frame.z);
    expect(d).toBeCloseTo(r, 6);
  });

  it('hides satellites below the minimum elevation', () => {
    expect(place(0, 10, 25)[0]).toBeNaN();
    expect(place(0, NaN)[0]).toBeNaN();
  });

  it('builds a closed elevation ring', () => {
    const ring = elevationRing(frame, 30_000, 25, 36);
    expect(ring.length).toBe(37 * 3);
    expect(ring[0]).toBeCloseTo(ring[36 * 3], 9);
    expect(ring[2]).toBeCloseTo(frame.z + Math.sin((25 * Math.PI) / 180) * r, 6);
  });
});
