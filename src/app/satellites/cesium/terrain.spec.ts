import { tileBounds3857 } from '../../core/dem-tiles';
import { maxLevelFor, SAMPLES, sampleBounds, sourceForTile } from './terrain';

/** XYZ tile containing a point at a zoom level. */
function tileAt(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

describe('terrain', () => {
  it('uses Kartverket in Norway from level 8 and open terrain elsewhere', () => {
    expect(sourceForTile(...tileAt(7.2, 62.1, 14), 14)).toBe('kartverket');
    expect(sourceForTile(...tileAt(7.2, 62.1, 6), 6)).toBe('terrarium');
    expect(sourceForTile(...tileAt(-122.4, 37.8, 14), 14)).toBe('terrarium');
  });

  it('stops refining at each source’s useful depth', () => {
    expect(maxLevelFor('kartverket')).toBeGreaterThan(maxLevelFor('terrarium'));
  });

  it('widens the request so sample centres land on the tile edges', () => {
    const [x, y] = tileAt(7.2, 62.1, 15);
    const tile = tileBounds3857(15, x, y);
    const req = sampleBounds(x, y, 15);
    const spacing = (tile[2] - tile[0]) / (SAMPLES - 1);
    // First and last pixel centres of the widened box sit exactly on the tile's west and east edges.
    const pixel = (req[2] - req[0]) / SAMPLES;
    expect(req[0] + pixel / 2).toBeCloseTo(tile[0], 6);
    expect(req[2] - pixel / 2).toBeCloseTo(tile[2], 6);
    expect(pixel).toBeCloseTo(spacing, 6);
  });
});
