// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Turns a measured ink bounding box into the four padding values that
 * [calculateDimensions] needs in order to land that content on the *finished,
 * trimmed* page with an exact top/bottom margin, horizontally centered.
 *
 * The user prints onto a large sheet, folds, binds, and only then guillotines
 * the block down to its final size. The spine fold can never be trimmed, so the
 * trim box sits hard against the binding edge of the layout cell, and all the
 * horizontal waste goes to the fore edge. Vertical waste is split evenly.
 *
 *   layout cell (cellW x cellH)
 *   +--------------------------------+   -- th/2 waste
 *   |  +----------------------+      |
 *   |  |        m             |      |
 *   |  |   +--------------+   | <-tw |   trim box (trimW x trimH)
 *   |  |   |   ink box    |   |      |
 *   |  |   +--------------+   |      |
 *   |  |        m             |      |
 *   |  +----------------------+      |
 *   +--------------------------------+   -- th/2 waste
 *   ^ spine / fold, never trimmed
 */

/**
 * @typedef AutoFitPadding
 * @type {object}
 * @property {number} top
 * @property {number} bottom
 * @property {number} binding
 * @property {number} fore_edge
 */

/**
 * @typedef AutoFitResult
 * @type {object}
 * @property {AutoFitPadding} padding - pre-scale padding, in source pt, for Book.padding_pt
 * @property {number} scale - the scale factor calculateDimensions will derive from that padding
 * @property {object} trimMargins - the resulting margins *on the trimmed page*, in pt
 * @property {string[]} warnings
 */

/**
 * @param {object} args
 * @param {{width: number, height: number}} args.inkBox - measured content size, in pt
 * @param {[number, number]} args.cell - the layout cell [width, height], in pt
 * @param {[number, number]} args.trim - the finished trimmed page [width, height], in pt
 * @param {number} args.marginTopBottom - desired margin above and below the content, in pt
 * @param {number} [args.extraGutter] - extra binding margin, in pt. Shifts the block
 *      towards the fore edge, for books whose spine swallows some of the page.
 * @returns {AutoFitResult}
 */
export function computeAutoFitPadding({ inkBox, cell, trim, marginTopBottom, extraGutter = 0 }) {
  const warnings = [];
  const [cellW, cellH] = cell;
  const [trimW, trimH] = trim;
  const wc = inkBox.width;
  const hc = inkBox.height;
  const m = marginTopBottom;
  const g = extraGutter;

  if (!(wc > 0) || !(hc > 0)) {
    throw new Error('Auto-fit needs a non-empty ink box');
  }
  if (!(trimW > 0) || !(trimH > 0)) {
    throw new Error('Auto-fit needs a non-empty trim size');
  }
  if (trimW > cellW || trimH > cellH) {
    warnings.push(
      `The trimmed size (${fmt(trimW)} x ${fmt(trimH)} pt) is larger than the layout cell ` +
        `(${fmt(cellW)} x ${fmt(cellH)} pt). Use a bigger sheet, or a layout with fewer pages per side.`
    );
  }
  if (2 * m >= trimH) {
    throw new Error('Top and bottom margins leave no room for content on the trimmed page');
  }
  if (g >= trimW) {
    throw new Error('The extra binding margin leaves no room for content on the trimmed page');
  }

  // Horizontal trim waste goes entirely to the fore edge; vertical waste is split.
  const tw = Math.max(cellW - trimW, 0);
  const th = Math.max(cellH - trimH, 0);

  // Normally the height drives the scale, so the top/bottom margin is exactly `m`.
  // The width term is a guard for unusually wide content: without it the block
  // would overflow the trim box sideways.
  const heightScale = (trimH - 2 * m) / hc;
  const widthScale = (trimW - g) / wc;
  const scale = Math.min(heightScale, widthScale);
  if (widthScale < heightScale) {
    warnings.push(
      'The content is too wide to honour the requested top/bottom margin, so it was scaled ' +
        'to fit the width instead. The top/bottom margins will be larger than requested.'
    );
  }

  const side = (trimW - wc * scale) / 2;
  const vert = (trimH - hc * scale) / 2;

  if (side - g < 0) {
    warnings.push(
      `The extra binding margin (${fmt(g)} pt) is larger than the available side margin ` +
        `(${fmt(side)} pt), which would push content off the fore edge. It has been capped.`
    );
  }
  // Never let the gutter eat more than the whole side margin.
  const gutter = Math.min(Math.max(g, 0), side);

  const padding = {
    top: (vert + th / 2) / scale,
    bottom: (vert + th / 2) / scale,
    binding: (side + gutter) / scale,
    fore_edge: (side - gutter + tw) / scale,
  };

  // calculateDimensions clamps padding at 0 when sizing the page but uses the raw
  // value when positioning it, so a negative would desynchronise the two.
  for (const key of Object.keys(padding)) {
    if (padding[key] < 0) {
      warnings.push(`Computed a negative ${key} margin; clamped to 0. The result will be off.`);
      padding[key] = 0;
    }
  }

  const foreEdgeMargin = side - gutter;
  if (gutter > 0 && foreEdgeMargin < side / 2) {
    warnings.push(
      `The fore-edge margin is now ${fmt(foreEdgeMargin)} pt against ${fmt(side + gutter)} pt at ` +
        'the binding. That is a lot of asymmetry - check it looks right before printing a whole book.'
    );
  }

  return {
    padding,
    scale,
    trimMargins: {
      top: vert,
      bottom: vert,
      binding: side + gutter,
      fore_edge: foreEdgeMargin,
    },
    warnings,
  };
}

const fmt = (n) => Number(n.toFixed(2));

/**
 * The size of a single page cell within the sheet, matching the arithmetic in
 * [calculateDimensions]. Kept here so the UI can show the trim/cell relationship
 * before a PDF has been loaded.
 *
 * @param {[number, number]} papersize
 * @param {{rows: number, cols: number, landscape: boolean}} pageLayout
 * @returns {[number, number]}
 */
export function layoutCellSize(papersize, pageLayout) {
  const x = papersize[0] / pageLayout.cols;
  const y = papersize[1] / pageLayout.rows;
  return pageLayout.landscape ? [y, x] : [x, y];
}
