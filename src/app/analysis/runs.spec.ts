import { runs } from './runs';

describe('runs', () => {
  const always = () => true;

  it('returns nothing when no ray is included', () => {
    expect(runs(8, () => false, always)).toEqual([]);
  });

  it('returns the whole circle as one run when everything is joined', () => {
    expect(runs(4, always, always)).toEqual([[0, 1, 2, 3]]);
  });

  it('keeps a run that wraps past ray 0 in one piece', () => {
    const included = new Set([6, 7, 0, 1, 4]);
    expect(runs(8, (k) => included.has(k), always)).toEqual([[4], [6, 7, 0, 1]]);
  });

  it('breaks runs where neighbours are not joined', () => {
    const status = ['a', 'a', 'b', 'b', 'b', 'a', 'a', 'a'];
    expect(runs(8, always, (i, j) => status[i] === status[j])).toEqual([[2, 3, 4], [5, 6, 7, 0, 1]]);
  });
});
