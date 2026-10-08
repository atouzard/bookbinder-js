// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from 'vitest';
import { aggregateBoxes, inkBoxFromImageData, samplePageIndices } from './inkBounds';

/** Builds an all-white RGBA canvas and hands back a painter for individual pixels. */
function canvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y, [r, g, b] = [0, 0, 0]) => {
    const i = (y * width + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  const fillRect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paint(x, y, color);
  };
  return { data, paint, fillRect };
}

describe('inkBoxFromImageData', () => {
  it('finds a solid block', () => {
    const c = canvas(100, 100);
    c.fillRect(20, 30, 40, 50);
    expect(inkBoxFromImageData(c.data, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 50 });
  });

  it('returns null for a blank page', () => {
    const c = canvas(100, 100);
    expect(inkBoxFromImageData(c.data, 100, 100)).toBeNull();
  });

  it('treats transparent pixels as paper', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4); // all zero: black but fully transparent
    expect(inkBoxFromImageData(data, 100, 100)).toBeNull();
  });

  it('ignores isolated speckle outside the block', () => {
    const c = canvas(1000, 1000);
    c.fillRect(200, 300, 400, 500);
    c.paint(5, 5); // scanner dust in the corner
    c.paint(995, 995);
    const box = inkBoxFromImageData(c.data, 1000, 1000);
    expect(box).toEqual({ x: 200, y: 300, width: 400, height: 500 });
  });

  it('removes a two-pixel speck but keeps a 2x2 blob, the documented cut-off', () => {
    const pair = canvas(200, 200);
    pair.fillRect(80, 80, 20, 20);
    pair.fillRect(5, 5, 2, 1); // two adjacent pixels of dust
    expect(inkBoxFromImageData(pair.data, 200, 200)).toEqual({
      x: 80,
      y: 80,
      width: 20,
      height: 20,
    });

    const blob = canvas(200, 200);
    blob.fillRect(80, 80, 20, 20);
    blob.fillRect(5, 5, 2, 2);
    expect(inkBoxFromImageData(blob.data, 200, 200).x).toBe(5);
  });

  it('keeps a faint but continuous rule, which speckle rejection must not eat', () => {
    const c = canvas(1000, 1000);
    c.fillRect(100, 50, 800, 1); // a hairline rule across the page
    c.fillRect(200, 300, 400, 500);
    const box = inkBoxFromImageData(c.data, 1000, 1000);
    expect(box.y).toBe(50);
    expect(box.x).toBe(100);
  });

  it('counts saturated colour as ink even when it is bright', () => {
    const c = canvas(100, 100);
    c.fillRect(10, 10, 20, 20, [255, 40, 40]); // bright red: high luminance, clearly ink
    expect(inkBoxFromImageData(c.data, 100, 100)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('reports a full-bleed page as covering everything', () => {
    const c = canvas(50, 50);
    c.fillRect(0, 0, 50, 50);
    expect(inkBoxFromImageData(c.data, 50, 50)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it('honours a looser threshold for washed-out scans', () => {
    const c = canvas(100, 100);
    c.fillRect(20, 20, 10, 10, [200, 200, 200]); // pale grey text
    expect(inkBoxFromImageData(c.data, 100, 100, { threshold: 100 })).toBeNull();
    expect(inkBoxFromImageData(c.data, 100, 100, { threshold: 220 })).toEqual({
      x: 20,
      y: 20,
      width: 10,
      height: 10,
    });
  });
});

describe('samplePageIndices', () => {
  it('returns every page when the document is smaller than the sample', () => {
    expect(samplePageIndices(4, 25)).toEqual([0, 1, 2, 3]);
  });

  it('returns every page when asked for all of them', () => {
    expect(samplePageIndices(3, 0)).toEqual([0, 1, 2]);
  });

  it('spreads the sample across the document and stays in range', () => {
    const picked = samplePageIndices(100, 5);
    expect(picked).toEqual([0, 20, 40, 60, 80]);
    expect(Math.max(...samplePageIndices(7, 5))).toBeLessThan(7);
  });
});

describe('aggregateBoxes', () => {
  const boxes = [
    { left: 10, bottom: 10, right: 90, top: 90 },
    { left: 12, bottom: 11, right: 88, top: 89 },
    { left: 11, bottom: 12, right: 89, top: 91 },
    { left: 10, bottom: 10, right: 91, top: 90 },
    { left: 0, bottom: 0, right: 100, top: 100 }, // a full-bleed plate
  ];

  it('unions by default, so nothing is ever clipped', () => {
    expect(aggregateBoxes(boxes)).toEqual({ left: 0, bottom: 0, right: 100, top: 100 });
  });

  it('can discard the outlier page when asked', () => {
    const tight = aggregateBoxes(boxes, 60);
    expect(tight.left).toBeGreaterThan(0);
    expect(tight.right).toBeLessThan(100);
  });

  it('returns null when there is nothing to aggregate', () => {
    expect(aggregateBoxes([])).toBeNull();
  });
});
