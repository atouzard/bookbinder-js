// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from 'vitest';
import { computeAutoFitPadding, layoutCellSize, suggestSheets } from './autoFit';
import { calculateDimensions } from './layout';
import {
  PAGE_LAYOUTS,
  PAGE_SIZES,
  TRIM_SIZE_PRESETS,
  trimPresetLabel,
  mmToPt,
  ptToMm,
} from '../constants';

/**
 * Runs the computed padding back through the real imposition math, which is the
 * only thing that proves the two agree.
 */
function impose({ inkBox, papersize, pageLayout, trim, marginTopBottom, extraGutter = 0 }) {
  const cell = layoutCellSize(papersize, pageLayout);
  const result = computeAutoFitPadding({ inkBox, cell, trim, marginTopBottom, extraGutter });
  const dimensions = calculateDimensions({
    cropbox: { width: inkBox.width, height: inkBox.height },
    padding_pt: result.padding,
    papersize,
    page_layout: pageLayout,
    alt_layout: null,
    page_positioning: 'centered',
    page_scaling: 'lockratio',
  });
  return { cell, result, dimensions };
}

// A B6 book (115 x 165mm pages) folded out of the B5 sheet it is printed on.
const B6_BOOK = {
  papersize: PAGE_SIZES.B5,
  pageLayout: PAGE_LAYOUTS.folio,
  trim: [mmToPt(115), mmToPt(165)],
  marginTopBottom: mmToPt(20),
};
// An A5 book (135 x 200mm pages) folded out of A4.
const A5_BOOK = {
  papersize: PAGE_SIZES.A4,
  pageLayout: PAGE_LAYOUTS.folio,
  trim: [mmToPt(135), mmToPt(200)],
  marginTopBottom: mmToPt(20),
};
// A larger block, only reachable through Custom, kept so the arithmetic is
// covered at a scale where the content is enlarged rather than reduced.
const LARGE_BOOK = {
  papersize: PAGE_SIZES.A3,
  pageLayout: PAGE_LAYOUTS.folio,
  trim: [mmToPt(200), mmToPt(270)],
  marginTopBottom: mmToPt(20),
};

describe('layoutCellSize', () => {
  it('matches the cell calculateDimensions derives, including the landscape swap', () => {
    expect(layoutCellSize(PAGE_SIZES.B4, PAGE_LAYOUTS.folio)).toEqual([500, 708]);
    expect(layoutCellSize(PAGE_SIZES.A3, PAGE_LAYOUTS.folio)).toEqual([595.5, 842]);
    expect(layoutCellSize(PAGE_SIZES.A4, PAGE_LAYOUTS.quarto)).toEqual([297.5, 421]);
  });
});

describe('computeAutoFitPadding', () => {
  it.each([
    ['B6 book', B6_BOOK],
    ['A5 book', A5_BOOK],
    ['large book', LARGE_BOOK],
  ])('%s: the padding reproduces exactly the scale it was derived from', (_name, book) => {
    const inkBox = { width: mmToPt(120), height: mmToPt(190) };
    const { cell, result, dimensions } = impose({ ...book, inkBox });

    // No fixed point to iterate towards: calculateDimensions must land on our scale.
    expect(dimensions.pdfScale[0]).toBeCloseTo(result.scale, 10);
    expect(dimensions.pdfScale[1]).toBeCloseTo(result.scale, 10);
    // ...which only holds because the padded page fills the cell exactly.
    expect(dimensions.pdfSize[0] * dimensions.pdfScale[0]).toBeCloseTo(cell[0], 10);
    expect(dimensions.pdfSize[1] * dimensions.pdfScale[1]).toBeCloseTo(cell[1], 10);
  });

  it.each([
    ['B6 book', B6_BOOK],
    ['A5 book', A5_BOOK],
    ['large book', LARGE_BOOK],
  ])('%s: lands the content with the requested margin on the trimmed page', (_name, book) => {
    const inkBox = { width: mmToPt(120), height: mmToPt(190) };
    const { cell, result, dimensions } = impose({ ...book, inkBox });
    const [trimW, trimH] = book.trim;

    // The vertical trim waste is split, so back it out to measure against the trim box.
    const vWaste = (cell[1] - trimH) / 2;
    expect(ptToMm(dimensions.yTopShiftFunc() - vWaste)).toBeCloseTo(20, 9);
    expect(ptToMm(dimensions.yBottomShiftFunc() - vWaste)).toBeCloseTo(20, 9);

    // All the horizontal waste sits on the fore edge, so only that one needs backing out.
    const hWaste = cell[0] - trimW;
    expect(dimensions.xBindingShiftFunc()).toBeCloseTo(dimensions.xForeEdgeShiftFunc() - hWaste, 9);

    // And the content really is the requested height.
    expect(ptToMm(inkBox.height * dimensions.pdfScale[1])).toBeCloseTo(ptToMm(trimH) - 40, 9);
    expect(result.trimMargins.top).toBeCloseTo(book.marginTopBottom, 9);
  });

  it('page positioning no longer matters, because the padded page fills the cell', () => {
    const inkBox = { width: mmToPt(120), height: mmToPt(190) };
    const cell = layoutCellSize(B6_BOOK.papersize, B6_BOOK.pageLayout);
    const { padding } = computeAutoFitPadding({ ...B6_BOOK, inkBox, cell });
    const base = {
      cropbox: { width: inkBox.width, height: inkBox.height },
      padding_pt: padding,
      papersize: B6_BOOK.papersize,
      page_layout: B6_BOOK.pageLayout,
      alt_layout: null,
      page_scaling: 'lockratio',
    };
    const centered = calculateDimensions({ ...base, page_positioning: 'centered' });
    const snug = calculateDimensions({ ...base, page_positioning: 'binding_aligned' });
    expect(snug.xForeEdgeShiftFunc()).toBeCloseTo(centered.xForeEdgeShiftFunc(), 10);
    expect(snug.xBindingShiftFunc()).toBeCloseTo(centered.xBindingShiftFunc(), 10);
  });

  it('shifts the block towards the fore edge by the extra binding margin', () => {
    const inkBox = { width: mmToPt(120), height: mmToPt(190) };
    const plain = impose({ ...B6_BOOK, inkBox });
    const gutter = impose({ ...B6_BOOK, inkBox, extraGutter: mmToPt(5) });

    expect(
      ptToMm(gutter.result.trimMargins.binding - plain.result.trimMargins.binding)
    ).toBeCloseTo(5, 9);
    expect(
      ptToMm(plain.result.trimMargins.fore_edge - gutter.result.trimMargins.fore_edge)
    ).toBeCloseTo(5, 9);
    // The gutter must not change the scale - only where the block sits.
    expect(gutter.result.scale).toBeCloseTo(plain.result.scale, 10);
  });

  it('caps a gutter that would push content off the fore edge, and says so', () => {
    const inkBox = { width: mmToPt(160), height: mmToPt(190) };
    const cell = layoutCellSize(B6_BOOK.papersize, B6_BOOK.pageLayout);
    const result = computeAutoFitPadding({ ...B6_BOOK, inkBox, cell, extraGutter: mmToPt(40) });

    expect(result.trimMargins.fore_edge).toBeGreaterThanOrEqual(0);
    expect(result.warnings.join(' ')).toMatch(/push content off the fore edge/);
  });

  it('falls back to fitting the width when the content is too wide for the height margin', () => {
    // 200mm wide content cannot fit 165mm of trim width at the height-driven scale.
    const inkBox = { width: mmToPt(200), height: mmToPt(100) };
    const cell = layoutCellSize(B6_BOOK.papersize, B6_BOOK.pageLayout);
    const result = computeAutoFitPadding({ ...B6_BOOK, inkBox, cell });

    expect(ptToMm(inkBox.width * result.scale)).toBeLessThanOrEqual(ptToMm(B6_BOOK.trim[0]) + 1e-9);
    expect(result.trimMargins.top).toBeGreaterThan(B6_BOOK.marginTopBottom);
    expect(result.warnings.join(' ')).toMatch(/too wide/);
  });

  it('refuses a trimmed size that does not fit the layout cell', () => {
    // You cannot trim a page down to something bigger than itself. Returning a
    // silently rescaled result here would only be discovered at the guillotine.
    expect(() =>
      computeAutoFitPadding({
        inkBox: { width: mmToPt(120), height: mmToPt(190) },
        cell: layoutCellSize(PAGE_SIZES.A5, PAGE_LAYOUTS.folio),
        trim: [mmToPt(165), mmToPt(240)],
        marginTopBottom: mmToPt(20),
      })
    ).toThrow(/doesn't fit the current layout cell/);
  });

  it.each([
    ['B6 book', B6_BOOK],
    ['A5 book', A5_BOOK],
    ['large book', LARGE_BOOK],
  ])('%s: measures against the finished size, not the sheet it is cut from', (_name, book) => {
    // The whole point: the margins must come out of the trimmed page. Two very
    // different sheets must therefore give identical margins on the book itself.
    const inkBox = { width: mmToPt(120), height: mmToPt(190) };
    const small = impose({ ...book, inkBox });
    const big = impose({ ...book, inkBox, papersize: PAGE_SIZES.A1 });

    expect(big.result.scale).toBeCloseTo(small.result.scale, 9);
    expect(ptToMm(big.result.trimMargins.top)).toBeCloseTo(20, 9);
    expect(ptToMm(big.result.trimMargins.binding)).toBeCloseTo(
      ptToMm(small.result.trimMargins.binding),
      9
    );
    // ...with the extra paper showing up purely as trim waste.
    expect(big.result.padding.fore_edge).toBeGreaterThan(small.result.padding.fore_edge);
  });

  it('never emits a negative padding', () => {
    const inkBox = { width: mmToPt(164), height: mmToPt(199) };
    const cell = layoutCellSize(B6_BOOK.papersize, B6_BOOK.pageLayout);
    const result = computeAutoFitPadding({ ...B6_BOOK, inkBox, cell, extraGutter: mmToPt(10) });
    Object.values(result.padding).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('rejects impossible inputs rather than producing silent nonsense', () => {
    const cell = layoutCellSize(B6_BOOK.papersize, B6_BOOK.pageLayout);
    expect(() =>
      computeAutoFitPadding({ ...B6_BOOK, cell, inkBox: { width: 0, height: 100 } })
    ).toThrow(/non-empty ink box/);
    expect(() =>
      computeAutoFitPadding({
        ...B6_BOOK,
        cell,
        inkBox: { width: 100, height: 100 },
        marginTopBottom: mmToPt(200),
      })
    ).toThrow(/no room for content/);
  });
});

describe('suggestSheets', () => {
  it('finds sheets a 200 x 270mm book can be trimmed out of', () => {
    const picks = suggestSheets([mmToPt(200), mmToPt(270)], PAGE_SIZES, PAGE_LAYOUTS);
    expect(picks.length).toBeGreaterThan(0);
    picks.forEach((p) => {
      expect(p.cell[0]).toBeGreaterThanOrEqual(mmToPt(200));
      expect(p.cell[1]).toBeGreaterThanOrEqual(mmToPt(270));
    });
    // A3 folio is what most people will actually have, so it must be offered.
    expect(picks).toContainEqual(expect.objectContaining({ paper: 'A3', layout: 'folio' }));
  });

  it('collapses sheets that are the same physical size under different names', () => {
    const picks = suggestSheets([mmToPt(200), mmToPt(270)], PAGE_SIZES, PAGE_LAYOUTS, 6);
    const cells = picks.map((p) => `${p.cell[0].toFixed(1)}x${p.cell[1].toFixed(1)}:${p.layout}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('suggests a B4 folio for a 165 x 240mm book', () => {
    const picks = suggestSheets([mmToPt(165), mmToPt(240)], PAGE_SIZES, PAGE_LAYOUTS);
    expect(picks[0]).toMatchObject({ paper: 'B4', layout: 'folio' });
  });

  it('returns nothing when no sheet is big enough', () => {
    expect(suggestSheets([mmToPt(2000), mmToPt(3000)], PAGE_SIZES, PAGE_LAYOUTS)).toEqual([]);
  });
});

describe('TRIM_SIZE_PRESETS', () => {
  const presets = Object.entries(TRIM_SIZE_PRESETS);

  it.each(presets)('%s is cut from a folio of the sheet its label names', (_name, preset) => {
    // Folding halves the sheet, so a book is always one size below the paper it
    // is printed on. Claiming otherwise in the label is the mistake this guards.
    const sheet = PAGE_SIZES[preset.sheet];
    expect(sheet).toBeDefined();
    const cell = layoutCellSize(sheet, PAGE_LAYOUTS.folio);
    expect(mmToPt(preset.width)).toBeLessThanOrEqual(cell[0]);
    expect(mmToPt(preset.height)).toBeLessThanOrEqual(cell[1]);
  });

  it.each(presets)('%s leaves something to actually trim off', (_name, preset) => {
    const cell = layoutCellSize(PAGE_SIZES[preset.sheet], PAGE_LAYOUTS.folio);
    // At least 2mm off the fore edge and 2mm off head and tail combined, or
    // there is no point running the block through a guillotine.
    expect(ptToMm(cell[0]) - preset.width).toBeGreaterThanOrEqual(2);
    expect(ptToMm(cell[1]) - preset.height).toBeGreaterThanOrEqual(2);
  });

  it.each(presets)(
    '%s leads with its own sheet when the wrong paper is selected',
    (_name, preset) => {
      const picks = suggestSheets(
        [mmToPt(preset.width), mmToPt(preset.height)],
        PAGE_SIZES,
        PAGE_LAYOUTS,
        3,
        preset.sheet
      );
      // Whatever the paper-waste arithmetic prefers, the advice has to agree
      // with the label: an "A5 book (print on A4)" cannot answer "use Letter".
      expect(`${picks[0].paper}/${picks[0].layout}`).toBe(`${preset.sheet}/folio`);
    }
  );

  it('labels the sheet to print on, not the book format alone', () => {
    expect(trimPresetLabel(TRIM_SIZE_PRESETS.A5_BOOK)).toBe(
      'A5 book - 135 x 200 mm page (print on A4, folded once)'
    );
  });
});
