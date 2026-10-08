// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Measures the "ink bounding box" of a source PDF: the outermost extent of
 * anything that actually puts marks on the page.
 *
 * This deliberately is *not* OCR. We don't care what the characters say, only
 * where the marks are, so rasterising and scanning pixels is both far faster
 * and far more reliable than text recognition -- and unlike a text-layer scan
 * it sees images, rules and figures too.
 *
 * Coordinate space: @cantoo/pdf-lib's page embedder works from the MediaBox
 * with its origin pinned to (0,0) and ignores /Rotate entirely (see
 * PDFPageEmbedder.fullPageBoundingBox). We therefore render with
 * `rotation: 0` and translate pdf.js' view box back onto the MediaBox, so the
 * box we hand to embedPages lands exactly where we measured it.
 */

const DEFAULT_OPTIONS = {
  /** Rasterisation resolution. 100dpi is plenty to find an edge within half a point. */
  dpi: 100,
  /** Maximum number of pages to rasterise. Pages are sampled evenly across the document. */
  sampleCount: 25,
  /** A channel value at or above this counts as "paper", below it counts as ink. */
  threshold: 250,
  /** Drop isolated specks of ink before measuring. Worth leaving on for scans. */
  despeckle: true,
  /**
   * How many of the 9 pixels in a 3x3 neighbourhood (itself included) must be inked
   * for a pixel to survive despeckling. 3 removes dust up to two pixels across while
   * keeping hairline rules, which are the thinnest thing we must never clip.
   */
  minNeighbors: 3,
};

/**
 * Reduces a canvas' pixels to an ink bounding box, in *pixels*, top-left origin.
 *
 * Split out from the rendering so it can be unit tested without a canvas.
 *
 * Noise is rejected by shape rather than by how much of a row is covered: a speck
 * of scanner dust has no inked neighbours, while a hairline rule - the thinnest
 * real mark a page can carry - always has two. Counting per-row coverage instead
 * would discard such a rule wherever it runs wider than the text block, and
 * clipping real content is the one outcome worth going out of our way to avoid.
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data, 4 bytes per pixel
 * @param {number} width
 * @param {number} height
 * @param {{threshold?: number, despeckle?: boolean, minNeighbors?: number}} [options]
 * @returns {{x: number, y: number, width: number, height: number}|null} null when the page is blank
 */
export function inkBoxFromImageData(data, width, height, options = {}) {
  const { threshold, despeckle, minNeighbors } = { ...DEFAULT_OPTIONS, ...options };

  const mask = new Uint8Array(width * height);
  for (let i = 0, px = 0; px < mask.length; px++, i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue; // fully transparent is paper
    // Composite against white, then take the darkest channel: a saturated colour
    // is ink even when its luminance is high.
    const a = alpha / 255;
    const inv = 255 * (1 - a);
    const r = data[i] * a + inv;
    const g = data[i + 1] * a + inv;
    const b = data[i + 2] * a + inv;
    if (Math.min(r, g, b) < threshold) mask[px] = 1;
  }

  const inked = despeckle ? despeckleMask(mask, width, height, minNeighbors) : mask;

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!inked[row + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Removes isolated specks of ink.
 *
 * Two passes. The first keeps only pixels with at least `minNeighbors` inked
 * pixels in their 3x3 neighbourhood, which discards dust but also erodes the very
 * tip of a hairline rule. The second puts back any original ink touching a
 * survivor, so real marks recover their full extent while specks - which have no
 * surviving neighbour - stay gone. Without it the box would creep inwards by a
 * pixel, and biasing towards clipping content is exactly what we can't afford.
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {number} minNeighbors
 * @returns {Uint8Array}
 */
function despeckleMask(mask, width, height, minNeighbors) {
  if (minNeighbors <= 1) return mask;

  const neighborhood = (cb) => {
    for (let y = 0; y < height; y++) {
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y < height - 1 ? y + 1 : height - 1;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!mask[idx]) continue;
        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x < width - 1 ? x + 1 : width - 1;
        cb(idx, x0, x1, y0, y1);
      }
    }
  };

  const survivors = new Uint8Array(mask.length);
  neighborhood((idx, x0, x1, y0, y1) => {
    let count = 0;
    for (let ny = y0; ny <= y1; ny++) {
      const row = ny * width;
      for (let nx = x0; nx <= x1; nx++) count += mask[row + nx];
    }
    if (count >= minNeighbors) survivors[idx] = 1;
  });

  const out = new Uint8Array(mask.length);
  neighborhood((idx, x0, x1, y0, y1) => {
    for (let ny = y0; ny <= y1; ny++) {
      const row = ny * width;
      for (let nx = x0; nx <= x1; nx++) {
        if (survivors[row + nx]) {
          out[idx] = 1;
          return;
        }
      }
    }
  });
  return out;
}

/**
 * Picks up to `count` page indices spread evenly across `total` pages.
 * @param {number} total
 * @param {number} count - 0 or less means "every page"
 * @returns {number[]} 0-based page indices
 */
export function samplePageIndices(total, count) {
  if (count <= 0 || count >= total) return Array.from({ length: total }, (_, i) => i);
  const step = total / count;
  const picked = new Set();
  for (let i = 0; i < count; i++) picked.add(Math.min(total - 1, Math.floor(i * step)));
  return [...picked].sort((a, b) => a - b);
}

/**
 * Combines per-page boxes into one. By default this is a true union, so no page
 * ever gets clipped; tightening `percentile` below 100 discards the most extreme
 * pages on each edge, which helps when a single full-bleed plate would otherwise
 * blow the box out to the full page.
 *
 * @param {{left: number, bottom: number, right: number, top: number}[]} boxes
 * @param {number} [percentile] - 100 = union
 * @returns {{left: number, bottom: number, right: number, top: number}|null}
 */
export function aggregateBoxes(boxes, percentile = 100) {
  if (boxes.length === 0) return null;
  if (percentile >= 100 || boxes.length < 5) {
    return {
      left: Math.min(...boxes.map((b) => b.left)),
      bottom: Math.min(...boxes.map((b) => b.bottom)),
      right: Math.max(...boxes.map((b) => b.right)),
      top: Math.max(...boxes.map((b) => b.top)),
    };
  }
  const drop = (1 - percentile / 100) / 2;
  const at = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(fraction * (sorted.length - 1)))
    );
    return sorted[idx];
  };
  return {
    left: at(
      boxes.map((b) => b.left),
      drop
    ),
    bottom: at(
      boxes.map((b) => b.bottom),
      drop
    ),
    right: at(
      boxes.map((b) => b.right),
      1 - drop
    ),
    top: at(
      boxes.map((b) => b.top),
      1 - drop
    ),
  };
}

let pdfjsPromise = null;

/** Loads pdf.js and points it at its worker. Deferred so the bundle only pays for it on demand. */
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.mjs?worker');
      pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * @typedef InkBounds
 * @type {object}
 * @property {{x: number, y: number, width: number, height: number}} box - in pt, MediaBox space
 * @property {{width: number, height: number}} pageSize - in pt
 * @property {number[]} sampled - page indices actually measured
 * @property {{page: number, x: number, y: number, width: number, height: number}[]} perPage
 * @property {string[]} warnings
 */

/**
 * Measures the ink bounding box of a PDF.
 *
 * @param {ArrayBuffer} arrayBuffer - the raw source PDF
 * @param {Partial<typeof DEFAULT_OPTIONS> & {
 *   percentile?: number,
 *   onProgress?: (done: number, total: number) => void
 * }} [options] - onProgress is called after each page, for a progress indicator
 * @returns {Promise<InkBounds|null>} null when the document has no ink at all
 */
export async function detectInkBounds(arrayBuffer, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings = [];
  const pdfjs = await loadPdfjs();

  // pdf.js transfers (and so neuters) the buffer it is given, and the caller
  // still needs theirs for pdf-lib.
  const doc = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise;

  try {
    const sampled = samplePageIndices(doc.numPages, opts.sampleCount);
    const scale = opts.dpi / 72;
    const perPage = [];
    const boxes = [];
    let pageSize = null;
    let rotatedPages = 0;

    let done = 0;
    const reportProgress = async () => {
      if (!opts.onProgress) return;
      opts.onProgress(++done, sampled.length);
      // Hand the browser a turn so the progress actually paints between pages.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    for (const index of sampled) {
      const page = await doc.getPage(index + 1);
      if (page.rotate % 360 !== 0) rotatedPages++;

      // rotation: 0 so we stay in the same unrotated space pdf-lib embeds from.
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // pdf.js renders onto a transparent canvas; paper is white.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixelBox = inkBoxFromImageData(image.data, canvas.width, canvas.height, opts);

      // The viewport maps the page's view box onto the canvas, so pixels convert
      // back into *native* content coordinates - which is exactly the space
      // pdf-lib's embedder expects a bounding box in.
      const [viewX0, viewY0, viewX1, viewY1] = viewport.viewBox;
      if (!pageSize) pageSize = { width: viewX1 - viewX0, height: viewY1 - viewY0 };

      if (!pixelBox) {
        await reportProgress();
        continue; // blank page (flyleaf, section break); nothing to measure
      }

      // Antialiasing can spread a mark that touches the page edge by a pixel, so
      // clamp: there is by definition no ink outside the page.
      const clampX = (v) => Math.min(Math.max(v, viewX0), viewX1);
      const clampY = (v) => Math.min(Math.max(v, viewY0), viewY1);
      const left = clampX(viewX0 + pixelBox.x / scale);
      const right = clampX(viewX0 + (pixelBox.x + pixelBox.width) / scale);
      // Canvas y grows downwards from the top of the view box, PDF y grows upwards.
      const top = clampY(viewY1 - pixelBox.y / scale);
      const bottom = clampY(viewY1 - (pixelBox.y + pixelBox.height) / scale);

      boxes.push({ left, bottom, right, top });
      perPage.push({
        page: index + 1,
        x: left,
        y: bottom,
        width: right - left,
        height: top - bottom,
      });

      await reportProgress();
    }

    if (boxes.length === 0) return null;

    const merged = aggregateBoxes(boxes, opts.percentile ?? 100);
    const box = {
      x: merged.left,
      y: merged.bottom,
      width: merged.right - merged.left,
      height: merged.top - merged.bottom,
    };

    if (rotatedPages > 0) {
      warnings.push(
        `${rotatedPages} of the ${sampled.length} sampled pages carry a /Rotate flag. ` +
          'Bookbinder ignores /Rotate when embedding, so use the "Rotate source PDF" option ' +
          'rather than relying on it.'
      );
    }
    if (box.width >= pageSize.width * 0.98 && box.height >= pageSize.height * 0.98) {
      warnings.push(
        'The content already covers virtually the whole page, so there is no margin to ' +
          'reclaim. Auto-fit will barely change anything.'
      );
    }

    return { box, pageSize, sampled, perPage, warnings };
  } finally {
    await doc.destroy();
  }
}
