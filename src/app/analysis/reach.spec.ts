import { CURVATURE } from './horizon';
import { lowestConeElevation, requiredReach, reachToFetch } from './reach';

describe('reach', () => {
  const standard = { azimuth: 0, tilt: 20, fov: 110 };

  it('finds the lowest cone elevation on the side the dish faces', () => {
    expect(Math.abs(lowestConeElevation(standard) - 15)).toBeLessThan(0.2);
    expect(Math.abs(lowestConeElevation({ azimuth: 0, tilt: 8, fov: 140 }) - 12)).toBeLessThan(0.2);
  });

  it('keeps the default Standard aim within 10 km even at sea level', () => {
    const d = requiredReach(standard, 0);
    expect(d).toBeLessThan(10_000);
    expect(reachToFetch(d)).toBe(10_000);
  });

  it('needs more than 10 km for Flat High Performance at sea level', () => {
    const d = requiredReach({ azimuth: 0, tilt: 8, fov: 140 }, 0);
    expect(d).toBeGreaterThan(10_000);
    expect(reachToFetch(d)).toBe(50_000);
  });

  it('solves the curvature equation exactly', () => {
    const z = 100;
    const d = requiredReach(standard, z);
    const angle = (Math.atan2(2470 - z - CURVATURE * d * d, d) * 180) / Math.PI;
    expect(Math.abs(angle - 15)).toBeLessThan(0.2);
  });

  it('needs nothing above the highest mountain', () => {
    expect(requiredReach(standard, 2500)).toBe(0);
  });
});
