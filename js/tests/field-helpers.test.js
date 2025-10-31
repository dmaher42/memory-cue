/**
 * @jest-environment jsdom
 */

const { describe, it, expect, beforeAll, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fieldHelpers;
let CUE_FIELD_DEFINITIONS;
let CUE_FIELD_ALIASES;
let DEFAULT_CUE_MODAL_TITLE;
let EDIT_CUE_MODAL_TITLE;
let getFieldElements;
let getCueFieldValueFromData;
let setCueFieldValue;
let readCueFieldValue;
let populateCueFormFields;
let clearCueFormFields;
let gatherCueFormData;
let escapeCueText;

function loadFieldHelpersModule() {
  const filePath = path.resolve(__dirname, '../modules/field-helpers.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+const/g, 'const')
    .replace(/export\s+function/g, 'function');
  source += `\nmodule.exports = {\n  CUE_FIELD_DEFINITIONS,\n  CUE_FIELD_ALIASES,\n  DEFAULT_CUE_MODAL_TITLE,\n  EDIT_CUE_MODAL_TITLE,\n  getFieldElements,\n  getCueFieldValueFromData,\n  setCueFieldValue,\n  readCueFieldValue,\n  populateCueFormFields,\n  clearCueFormFields,\n  gatherCueFormData,\n  escapeCueText\n};\n`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    document,
    window,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

beforeAll(() => {
  fieldHelpers = loadFieldHelpersModule();
  ({
    CUE_FIELD_DEFINITIONS,
    CUE_FIELD_ALIASES,
    DEFAULT_CUE_MODAL_TITLE,
    EDIT_CUE_MODAL_TITLE,
    getFieldElements,
    getCueFieldValueFromData,
    setCueFieldValue,
    readCueFieldValue,
    populateCueFormFields,
    clearCueFormFields,
    gatherCueFormData,
    escapeCueText
  } = fieldHelpers);
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('constants', () => {
  it('exports cue field definitions and aliases', () => {
    expect(Array.isArray(CUE_FIELD_DEFINITIONS)).toBe(true);
    expect(CUE_FIELD_DEFINITIONS.length).toBeGreaterThan(0);
    expect(CUE_FIELD_ALIASES).toHaveProperty('title');
  });

  it('provides modal title constants', () => {
    expect(DEFAULT_CUE_MODAL_TITLE).toBe('Create Cue');
    expect(EDIT_CUE_MODAL_TITLE).toBe('Edit Cue');
  });
});

describe('getFieldElements', () => {
  it('locates elements based on the provided definitions', () => {
    document.body.innerHTML = `
      <input id="cue-title" />
      <textarea id="details"></textarea>
      <input id="cue-date" />
    `;

    const elements = getFieldElements(CUE_FIELD_DEFINITIONS);
    const keys = elements.map((entry) => entry.key);

    expect(elements.length).toBeGreaterThanOrEqual(3);
    expect(keys).toContain('title');
    expect(keys).toContain('details');
  });

  it('returns an empty array when no definitions are provided', () => {
    expect(getFieldElements(null)).toEqual([]);
    expect(getFieldElements(undefined)).toEqual([]);
  });
});

describe('getCueFieldValueFromData', () => {
  it('resolves values using aliases', () => {
    const data = { name: 'Alias Title', description: 'Details text' };
    expect(getCueFieldValueFromData(data, 'title')).toBe('Alias Title');
    expect(getCueFieldValueFromData(data, 'details')).toBe('Details text');
  });

  it('normalises non-string values to strings', () => {
    const data = { priority: 5 };
    expect(getCueFieldValueFromData(data, 'priority')).toBe('5');
  });

  it('returns an empty string for missing values', () => {
    expect(getCueFieldValueFromData(null, 'title')).toBe('');
    expect(getCueFieldValueFromData({}, 'unknown')).toBe('');
  });
});

describe('setCueFieldValue and readCueFieldValue', () => {
  it('supports text inputs, textareas, selects, and checkboxes', () => {
    const textInput = document.createElement('input');
    textInput.type = 'text';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const option = document.createElement('option');
    option.value = 'Option';
    select.append(option);

    setCueFieldValue(textInput, 'Hello');
    setCueFieldValue(checkbox, true);
    setCueFieldValue(textarea, 'Notes');
    setCueFieldValue(select, 'Option');

    expect(readCueFieldValue(textInput)).toBe('Hello');
    expect(readCueFieldValue(checkbox)).toBe(true);
    expect(readCueFieldValue(textarea)).toBe('Notes');
    expect(readCueFieldValue(select)).toBe('Option');
  });

  it('handles null or undefined elements gracefully', () => {
    expect(readCueFieldValue(null)).toBe('');
    expect(() => setCueFieldValue(null, 'value')).not.toThrow();
  });
});

describe('populateCueFormFields', () => {
  it('applies cue data to the resolved fields', () => {
    document.body.innerHTML = `
      <input id="cue-title" />
      <textarea id="cue-details"></textarea>
    `;
    const elements = getFieldElements([
      { key: 'title', ids: ['cue-title'] },
      { key: 'details', ids: ['cue-details'] }
    ]);

    populateCueFormFields({ title: 'My Cue', details: 'Remember this' }, elements);

    expect(readCueFieldValue(elements[0].element)).toBe('My Cue');
    expect(readCueFieldValue(elements[1].element)).toBe('Remember this');
  });

  it('clears fields when cue data is not provided', () => {
    document.body.innerHTML = `<input id="cue-title" value="Existing" />`;
    const elements = getFieldElements([{ key: 'title', ids: ['cue-title'] }]);

    populateCueFormFields(null, elements);

    expect(readCueFieldValue(elements[0].element)).toBe('');
  });
});

describe('clearCueFormFields', () => {
  it('resets field values and metadata elements', () => {
    document.body.innerHTML = `
      <input id="cue-title" value="Existing" />
      <input id="cue-id-input" value="123" />
      <h2 id="modal-title">Edit Cue</h2>
    `;
    const elements = getFieldElements([{ key: 'title', ids: ['cue-title'] }]);
    const cueIdInput = document.getElementById('cue-id-input');
    const cueModalTitle = document.getElementById('modal-title');

    clearCueFormFields(elements, cueIdInput, cueModalTitle, DEFAULT_CUE_MODAL_TITLE);

    expect(readCueFieldValue(elements[0].element)).toBe('');
    expect(cueIdInput.value).toBe('');
    expect(cueModalTitle.textContent).toBe(DEFAULT_CUE_MODAL_TITLE);
  });
});

describe('gatherCueFormData', () => {
  it('collects trimmed values and booleans', () => {
    document.body.innerHTML = `
      <input id="cue-title" value="  My Cue  " />
      <textarea id="cue-details"> Note </textarea>
      <input id="cue-priority" type="checkbox" checked />
    `;
    const elements = getFieldElements([
      { key: 'title', ids: ['cue-title'] },
      { key: 'details', ids: ['cue-details'] },
      { key: 'priority', ids: ['cue-priority'] }
    ]);

    const data = gatherCueFormData(elements);

    expect(data).toEqual({ title: 'My Cue', details: 'Note', priority: true });
  });

  it('returns an empty object when elements are not provided', () => {
    expect(gatherCueFormData(null)).toEqual({});
  });
});

describe('escapeCueText', () => {
  it('escapes HTML special characters', () => {
    const escaped = escapeCueText("<div>&\"'</div>");
    expect(escaped).toBe('&lt;div&gt;&amp;&quot;&#39;&lt;/div&gt;');
  });

  it('returns an empty string for nullish values', () => {
    expect(escapeCueText(null)).toBe('');
    expect(escapeCueText(undefined)).toBe('');
  });
});
