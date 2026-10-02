import { fromUtm33, toUtm33, trueNorthGridAzimuth } from './geo';

describe('geo', () => {
  it('round-trips WGS84 <-> UTM33', () => {
    const { e, n } = toUtm33(10.75, 59.91);
    const [lon, lat] = fromUtm33(e, n);
    expect(Math.abs(lon - 10.75)).toBeLessThan(1e-7);
    expect(Math.abs(lat - 59.91)).toBeLessThan(1e-7);
  });

  it('puts true north at about +8.4° grid azimuth at Bergen and ~0 on the central meridian', () => {
    expect(Math.abs(trueNorthGridAzimuth(5.32, 60.39) - 8.44)).toBeLessThan(0.1);
    expect(Math.abs(trueNorthGridAzimuth(15, 65))).toBeLessThan(0.01);
    expect(trueNorthGridAzimuth(29, 70)).toBeLessThan(-12);
  });
});
