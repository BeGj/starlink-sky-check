import { coneFloorAt, evaluateCone } from './cone';
import { Horizon } from './horizon';

function constantHorizon(angle: number, rays = 720): Horizon {
  return { angles: new Float32Array(rays).fill(angle), distances: new Float32Array(rays) };
}

describe('evaluateCone', () => {
  const aim = { azimuth: 0, tilt: 20, fov: 110 };

  it('is unobstructed with a flat horizon', () => {
    expect(evaluateCone(constantHorizon(0), aim).obstructedFraction).toBe(0);
  });

  it('is fully obstructed when the horizon is at the zenith', () => {
    expect(evaluateCone(constantHorizon(90), aim).obstructedFraction).toBe(1);
  });

  it('matches the analytic fraction for a vertical cone and a uniform horizon', () => {
    // Vertical cone, half-angle 55°: cap of solid angle 2π(1 - cos 55°).
    // A uniform horizon at 20° hides the band between elevation 35° and 20°... i.e. zenith angles 55°..70°,
    // which lies outside the cone, so a horizon at 45° hides zenith angles 45°..55° instead.
    const vertical = { azimuth: 0, tilt: 0, fov: 110 };
    const cap = (deg: number) => 1 - Math.cos((deg * Math.PI) / 180);
    const expected = (cap(55) - cap(45)) / cap(55);
    const got = evaluateCone(constantHorizon(45), vertical).obstructedFraction;
    expect(Math.abs(got - expected)).toBeLessThan(0.01);
  });

  it('blocks more when a wall is on the side the dish faces', () => {
    const rays = 720;
    const wallNorth = constantHorizon(0, rays);
    const wallSouth = constantHorizon(0, rays);
    for (let i = 0; i < rays; i++) {
      const az = (i * 360) / rays;
      if (az <= 45 || az >= 315) wallNorth.angles[i] = 30;
      if (az >= 135 && az <= 225) wallSouth.angles[i] = 30;
    }
    const north = evaluateCone(wallNorth, aim).obstructedFraction;
    const south = evaluateCone(wallSouth, aim).obstructedFraction;
    expect(north).toBeGreaterThan(0);
    expect(south).toBe(0);
  });
});

describe('coneFloorAt', () => {
  it('is 90 - tilt - half-angle on the facing side and higher on the opposite side', () => {
    const aim = { azimuth: 0, tilt: 20, fov: 110 };
    expect(Math.abs(coneFloorAt(aim, 0) - 15)).toBeLessThan(0.2);
    expect(Math.abs(coneFloorAt(aim, 180) - 55)).toBeLessThan(0.2);
  });
});
