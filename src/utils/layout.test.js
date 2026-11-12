import { describe, it, expect } from 'vitest';
import { rtlCellOrder } from './layout';
import { PAGE_LAYOUTS } from '../constants';

describe('rtlCellOrder', () => {
  it('swaps the two quarter-turned folio cells', () => {
    expect(rtlCellOrder(PAGE_LAYOUTS.folio.rotations)).toEqual([1, 0]);
  });

  it('swaps horizontal neighbours in upright and upside-down quarto rows', () => {
    expect(rtlCellOrder(PAGE_LAYOUTS.quarto.rotations)).toEqual([1, 0, 3, 2]);
  });

  it('swaps vertical neighbours in octavo (quarter-turned) rows', () => {
    expect(rtlCellOrder(PAGE_LAYOUTS.octavo.rotations)).toEqual([2, 3, 0, 1, 6, 7, 4, 5]);
  });

  it('is its own inverse for every layout', () => {
    Object.values(PAGE_LAYOUTS).forEach(({ rotations }) => {
      const order = rtlCellOrder(rotations);
      expect(order.map((i) => order[i])).toEqual(order.map((_, i) => i));
    });
  });
});
