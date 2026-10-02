import { coneFloorAt, evaluateCone, satelliteWeight } from './cone';
import { Horizon } from './horizon';

function constantHorizon(angle: number, rays = 720): Horizon {
  return { angles: new Float32Array(rays).fill(angle), distances: new Float32Array(rays) };
}

describe('evaluateCone', () => {
  const aim = { azimuth: 0, tilt: 20, fov: 110, minElevation: 0 };

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
    const vertical = { azimuth: 0, tilt: 0, fov: 110, minElevation: 0 };
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

  it('only counts sky above the minimum elevation', () => {
    // Vertical cone, half-angle 55° (down to elevation 35°), minimum 45°: usable cap is zenith angles 0..45°.
    // A uniform horizon at 50° hides zenith angles 40..45° of it.
    const vertical = { azimuth: 0, tilt: 0, fov: 110, minElevation: 45 };
    const cap = (deg: number) => 1 - Math.cos((deg * Math.PI) / 180);
    const expected = (cap(45) - cap(40)) / cap(45);
    const got = evaluateCone(constantHorizon(50), vertical).obstructedFraction;
    expect(Math.abs(got - expected)).toBeLessThan(0.01);
    // A horizon below the minimum hides nothing.
    expect(evaluateCone(constantHorizon(40), vertical).obstructedFraction).toBe(0);
  });

  it('is NaN when the whole cone is below the minimum elevation', () => {
    const low = { azimuth: 0, tilt: 60, fov: 10, minElevation: 40 };
    const result = evaluateCone(constantHorizon(0), low);
    expect(result.obstructedFraction).toBeNaN();
    expect(result.weightedObstructedFraction).toBeNaN();
    expect(result.floor.every((f) => Number.isNaN(f))).toBe(true);
  });

  it('weights low obstructions more than the plain share', () => {
    const vertical = { azimuth: 0, tilt: 0, fov: 110, minElevation: 0 };
    const result = evaluateCone(constantHorizon(45), vertical);
    expect(result.weightedObstructedFraction).toBeGreaterThan(result.obstructedFraction);
  });
});

describe('satelliteWeight', () => {
  it('is 1 at the zenith and grows towards the horizon', () => {
    expect(satelliteWeight(90)).toBeCloseTo(1, 6);
    expect(satelliteWeight(60)).toBeGreaterThan(1);
    expect(satelliteWeight(25)).toBeGreaterThan(satelliteWeight(60));
    expect(satelliteWeight(25)).toBeGreaterThan(6);
    expect(satelliteWeight(25)).toBeLessThan(9);
  });
});

describe('coneFloorAt', () => {
  it('is 90 - tilt - half-angle on the facing side and higher on the opposite side', () => {
    const aim = { azimuth: 0, tilt: 20, fov: 110, minElevation: 0 };
    expect(Math.abs(coneFloorAt(aim, 0) - 15)).toBeLessThan(0.2);
    expect(Math.abs(coneFloorAt(aim, 180) - 55)).toBeLessThan(0.2);
  });

  it('is raised to the minimum elevation', () => {
    const aim = { azimuth: 0, tilt: 20, fov: 110, minElevation: 25 };
    expect(coneFloorAt(aim, 0)).toBe(25);
    expect(Math.abs(coneFloorAt(aim, 180) - 55)).toBeLessThan(0.2);
  });
});
