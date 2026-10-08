// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { saveForm, updateRenderedForm } from './formUtils';
import {
  updatePaperSelectOptionsUnits,
  updateAddOrRemoveCustomPaperOption,
  clearPreview,
  renderAutoFit,
  syncTrimSizeToSelection,
} from './renderUtils';

/**
 * @param book
 * @param bookbinderForm
 * @param {HTMLElement} [changed] - the field the user just edited, when known. Lets
 *      dependent fields update before the form is read back.
 */
export function handleInputChange(book, bookbinderForm, changed) {
  // Both of these run before the form is read: a custom paper size feeds
  // PAGE_SIZES, and the finished size follows from the resulting cell.
  updateAddOrRemoveCustomPaperOption();
  updatePaperSelectOptionsUnits(); // make sure this goes AFTER the Custom update!
  if (changed) {
    syncTrimSizeToSelection(changed.name);
  }

  const formData = new FormData(bookbinderForm);
  const updatedConfiguration = saveForm(formData);
  book.update(updatedConfiguration);
  if (book.inputpdf) {
    updateRenderedForm(book);
  } else {
    // There is nothing to re-impose yet, but the auto-fit panel still has to
    // open, close and keep its button in step.
    renderAutoFit(book, null);
  }
}

export function handleFileChange(e, book) {
  clearPreview();
  const fileList = e.target.files;
  if (fileList.length > 0) {
    const updated = book.openpdf(fileList[0]);
    updated.then(() => updateRenderedForm(book));
  }
}
