// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Book } from './book.js';
import { loadForm, runInkMeasurement } from './utils/formUtils.js';
import { handleFileChange, handleInputChange } from './utils/changeHandlers.js';
import {
  handleGenerateClick,
  handlePreviewClick,
  handleResetSettingsClick,
  handleSewingMarksCheckboxState,
} from './utils/clickHandlers.js';
import { renderPaperSelectOptions, renderTrimSizeOptions } from './utils/renderUtils.js';
import { TRIM_SIZE_PRESETS } from './constants.js';

window.addEventListener('DOMContentLoaded', () => {
  // render dynamic content
  renderPaperSelectOptions();
  renderTrimSizeOptions();
  const configuration = loadForm();

  // grab DOM elements
  const generate = document.getElementById('generate');
  const preview = document.getElementById('preview');
  const resetSettings = document.getElementById('reset_settings');
  const bookbinderForm = document.getElementById('bookbinder');
  const fileInput = document.getElementById('input_file');
  const inputs = document.querySelectorAll('input, select');
  const sourceRotation = document.getElementById('source_rotation');
  const sewingMarks = document.getElementById('add_sewing_marks_checkbox');
  const trimSizePreset = document.getElementById('trim_size_preset');
  const measureInk = document.getElementById('measure_ink');
  const sourceRotationExamples = Array.from(
    document.getElementsByClassName('source_rotation_example')
  );

  // spin up a book to pass to listeners
  const book = new Book(configuration);

  // add event listeners to grabbed elements
  inputs.forEach((input) => {
    input.addEventListener('change', () => handleInputChange(book, bookbinderForm));
  });
  fileInput.addEventListener('change', (e) => {
    handleFileChange(e, book);
    generate.removeAttribute('disabled');
    preview.removeAttribute('disabled');
  });
  // Measuring is explicit rather than automatic: it rasterises pages, and it's
  // worth re-running after swapping the file or changing the detection settings.
  measureInk.addEventListener('click', () => runInkMeasurement(book));
  generate.addEventListener('click', () => handleGenerateClick(generate, book));
  preview.addEventListener('click', () => handlePreviewClick(preview, book));
  resetSettings.addEventListener('click', () => {
    console.log('Resetting settings...');
    handleResetSettingsClick(book);
  });
  sourceRotation.addEventListener('change', (e) => {
    const selectedValue = `${e.target.value}_example`;
    sourceRotationExamples.forEach((example) => {
      example.style.display = example.id === selectedValue ? 'flex' : 'none';
    });
  });
  sewingMarks.addEventListener('change', (e) => {
    const willBeEnabled = e.srcElement.checked;
    handleSewingMarksCheckboxState(willBeEnabled);
  });
  // Picking a preset fills in the width/height; editing those by hand is what
  // 'Custom' means, so leave the preset alone from here on.
  trimSizePreset.addEventListener('change', (e) => {
    const preset = TRIM_SIZE_PRESETS[e.target.value];
    if (!preset) return;
    document.getElementById('trim_size_unit').value = 'mm';
    document.getElementById('trim_size_width').value = preset.width;
    document.getElementById('trim_size_height').value = preset.height;
    handleInputChange(book, bookbinderForm);
  });
});
