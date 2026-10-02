import { decodeSpots, encodeSpots } from './url-state';
import { SpotSettings } from './spot';

describe('url-state', () => {
  it('round-trips spots including a custom kit', () => {
    const spots: SpotSettings[] = [
      { lat: 61.123456, lon: 9.654321, height: 5.5, kitId: 'std', fov: 110, azimuth: 0, tilt: 20, trees: true, skipRadius: 8 },
      { lat: 60.5, lon: 5.25, height: 2, kitId: 'custom', fov: 120, azimuth: 350, tilt: 15, trees: false, skipRadius: 2.5 },
    ];
    expect(decodeSpots(encodeSpots(spots))).toEqual(spots);
  });

  it('defaults the skip radius for links without it', () => {
    expect(decodeSpots('61,9,5,mini,0,20,1')[0].skipRadius).toBe(8);
  });

  it('skips malformed entries', () => {
    expect(decodeSpots('abc;61,9,5,nope,0,20,1;61,9,5,mini,0,20,1')).toHaveLength(1);
    expect(decodeSpots(null)).toEqual([]);
  });
});
