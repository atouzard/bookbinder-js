// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { readFileSync } from 'node:fs';
import { expect, describe, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { Book } from './book';
import { schema } from './models/configuration';
import { mmToPt, ptToMm } from './constants';

/**
 * Exercises the whole auto-fit chain on a real document: crop the source at embed
 * time, derive the padding from the cropped box, and impose. The rasterising half
 * (inkBounds) needs a canvas, so the measurement is stubbed with a known box -
 * what's under test here is that everything downstream honours it.
 */
describe('Book auto-fit', () => {
  // A plain A4 source, so the stubbed ink box below is a genuine sub-rectangle of the page.
  const sourcePdf = new Uint8Array(readFileSync('pdf-test/files/basic_duplex_folio.pdf'));

  /** @param {object} overrides */
  async function buildBook(overrides = {}, inkBox) {
    const book = new Book(
      schema.parse({
        autoFitEnabled: true,
        paperSize: 'B4',
        pageLayout: 'folio',
        trimSizeUnit: 'mm',
        trimSizeWidth: 165,
        trimSizeHeight: 240,
        contentMarginTopBottom: 20,
        ...overrides,
      })
    );
    book.inputpdf = 'basic_duplex_folio.pdf';
    book.input = sourcePdf;
    book.currentdoc = await PDFDocument.load(sourcePdf);
    book.fixBlankPages();
    book.inkBounds = { box: inkBox, pageSize: null, sampled: [], perPage: [], warnings: [] };
    return book;
  }

  it('crops the embedded pages down to the measured ink box', async () => {
    const inkBox = { x: 40, y: 60, width: 300, height: 500 };
    const book = await buildBook({}, inkBox);

    const info = await book.createpages();

    // The managed pages - and so the cropbox the layout math reads - are the ink box.
    expect(info.cropbox.width).toBeCloseTo(inkBox.width, 6);
    expect(info.cropbox.height).toBeCloseTo(inkBox.height, 6);
  });

  it('places the content with the requested margins on the trimmed page', async () => {
    const inkBox = { x: 40, y: 60, width: 300, height: 500 };
    const book = await buildBook({}, inkBox);

    const { dimensions, autoFit } = await book.createpages();
    const cell = dimensions.layoutCell;
    const [trimW, trimH] = [mmToPt(165), mmToPt(240)];

    // Folding B4 gives a B5 cell, which we then trim to 165 x 240mm.
    expect(cell[0]).toBeCloseTo(500, 6);
    expect(cell[1]).toBeCloseTo(708, 6);

    const vWaste = (cell[1] - trimH) / 2;
    expect(ptToMm(dimensions.yTopShiftFunc() - vWaste)).toBeCloseTo(20, 6);
    expect(ptToMm(dimensions.yBottomShiftFunc() - vWaste)).toBeCloseTo(20, 6);

    const hWaste = cell[0] - trimW;
    expect(dimensions.xBindingShiftFunc()).toBeCloseTo(dimensions.xForeEdgeShiftFunc() - hWaste, 6);

    // Content fills the trim height minus both margins, exactly.
    expect(ptToMm(inkBox.height * dimensions.pdfScale[1])).toBeCloseTo(240 - 40, 6);
    expect(autoFit.warnings).toEqual([]);
  });

  it('forces proportional scaling, since the derivation assumes it', async () => {
    const book = await buildBook(
      { pageScaling: 'stretch' },
      { x: 0, y: 0, width: 300, height: 500 }
    );
    await book.createpages();
    expect(book.page_scaling).toBe('lockratio');
  });

  it('leaves the manual margins alone when auto-fit is off', async () => {
    const book = await buildBook(
      { autoFitEnabled: false, topEdgePaddingPt: 7, bindingEdgePaddingPt: 9 },
      { x: 40, y: 60, width: 300, height: 500 }
    );
    const info = await book.createpages();

    expect(book.padding_pt.top).toBe(7);
    expect(book.padding_pt.binding).toBe(9);
    expect(info.autoFit).toBeNull();
    // ...and the pages keep their full A4 size rather than being cropped.
    expect(info.cropbox.width).toBeCloseTo(595, 6);
    expect(info.cropbox.height).toBeCloseTo(842, 6);
  });

  it('still crops correctly when the source pages are rotated a quarter turn', async () => {
    const inkBox = { x: 40, y: 60, width: 300, height: 500 };
    const book = await buildBook({ sourceRotation: '90cw' }, inkBox);

    const info = await book.createpages();

    // Rotating swaps the box's axes, and the layout must follow.
    expect(info.cropbox.width).toBeCloseTo(inkBox.height, 6);
    expect(info.cropbox.height).toBeCloseTo(inkBox.width, 6);
  });
});
