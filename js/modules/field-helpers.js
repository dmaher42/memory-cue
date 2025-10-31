/**
 * Field helper utilities for cue forms.
 * @module field-helpers
 */

/**
 * Definitions for cue fields and their associated DOM element IDs.
 * @type {Array<{key: string, ids: string[]}>}
 */
export const CUE_FIELD_DEFINITIONS = [
  { key: 'title', ids: ['cue-title', 'title'] },
  { key: 'details', ids: ['cue-details', 'details', 'cue-description'] },
  { key: 'date', ids: ['cue-date', 'date'] },
  { key: 'time', ids: ['cue-time', 'time'] },
  { key: 'priority', ids: ['cue-priority', 'priority'] },
  { key: 'category', ids: ['cue-category', 'category'] }
];

/**
 * Aliases for cue fields to support various data shapes.
 * @type {Record<string, string[]>}
 */
export const CUE_FIELD_ALIASES = {
  title: ['title', 'name'],
  details: ['details', 'description', 'notes', 'body'],
  date: ['date', 'dueDate', 'due_date'],
  time: ['time', 'dueTime', 'due_time'],
  priority: ['priority', 'level'],
  category: ['category', 'tag']
};

/** Default modal title when creating a cue. */
export const DEFAULT_CUE_MODAL_TITLE = 'Create Cue';

/** Modal title when editing an existing cue. */
export const EDIT_CUE_MODAL_TITLE = 'Edit Cue';

/**
 * Finds the field elements based on the provided definitions.
 *
 * @param {Array<{key: string, ids: string[]}>} definitions - Field definitions to resolve.
 * @param {Document} [doc=document] - Document instance used to look up elements.
 * @returns {Array<{key: string, element: HTMLElement}>} Resolved field elements.
 */
export function getFieldElements(definitions, doc = document) {
  if (!Array.isArray(definitions) || !doc || typeof doc.getElementById !== 'function') {
    return [];
  }

  return definitions
    .map(({ key, ids }) => {
      if (!Array.isArray(ids)) {
        return null;
      }
      for (const id of ids) {
        if (typeof id !== 'string' || !id) {
          continue;
        }
        const element = doc.getElementById(id);
        if (element) {
          return { key, element };
        }
      }
      return null;
    })
    .filter((entry) => Boolean(entry && entry.element));
}

/**
 * Retrieves a cue field value from a generic data object.
 *
 * @param {Record<string, unknown>|null|undefined} data - The source data.
 * @param {string} key - The cue field key to resolve.
 * @returns {string} The resolved field value as a string.
 */
export function getCueFieldValueFromData(data, key) {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const possibleKeys = CUE_FIELD_ALIASES[key] || [key];
  for (const field of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const value = data[field];
      if (value === null || value === undefined) {
        return '';
      }
      return typeof value === 'string' ? value : String(value);
    }
  }

  return '';
}

/**
 * Sets the value of a cue field element.
 *
 * @param {HTMLElement|null|undefined} element - The target field element.
 * @param {unknown} value - The value to apply.
 * @returns {void}
 */
export function setCueFieldValue(element, value) {
  if (!element) {
    return;
  }

  const normalised = value === undefined || value === null ? '' : value;

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      element.checked = Boolean(normalised);
    } else {
      element.value = typeof normalised === 'string' ? normalised : String(normalised);
    }
    return;
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    element.value = typeof normalised === 'string' ? normalised : String(normalised);
  }
}

/**
 * Reads the value from a cue field element.
 *
 * @param {HTMLElement|null|undefined} element - The target field element.
 * @returns {string|boolean} The field value.
 */
export function readCueFieldValue(element) {
  if (!element) {
    return '';
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      return element.checked;
    }
    return element.value;
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value;
  }

  return '';
}

/**
 * Populates cue form fields from a cue object.
 *
 * @param {Record<string, unknown>|null|undefined} cue - The cue data.
 * @param {Array<{key: string, element: HTMLElement}>} fieldElements - Resolved field elements.
 * @returns {void}
 */
export function populateCueFormFields(cue, fieldElements) {
  if (!Array.isArray(fieldElements)) {
    return;
  }

  fieldElements.forEach(({ key, element }) => {
    const value = cue && typeof cue === 'object' ? getCueFieldValueFromData(cue, key) : '';
    setCueFieldValue(element, value);
  });
}

/**
 * Clears cue form fields and related metadata inputs.
 *
 * @param {Array<{element: HTMLElement}>} fieldElements - Resolved field elements.
 * @param {HTMLInputElement|null|undefined} cueIdInput - The cue ID input element.
 * @param {HTMLElement|null|undefined} cueModalTitle - The modal title element.
 * @param {string} defaultTitle - Default title text to restore.
 * @returns {void}
 */
export function clearCueFormFields(fieldElements, cueIdInput, cueModalTitle, defaultTitle) {
  if (Array.isArray(fieldElements)) {
    fieldElements.forEach(({ element }) => {
      if (element instanceof HTMLInputElement) {
        if (['checkbox', 'radio'].includes(element.type)) {
          element.checked = false;
        } else {
          element.value = '';
        }
      } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        element.value = '';
      }
    });
  }

  if (cueIdInput) {
    cueIdInput.value = '';
  }

  if (cueModalTitle) {
    cueModalTitle.textContent = defaultTitle;
  }
}

/**
 * Gathers cue form field data into a plain object.
 *
 * @param {Array<{key: string, element: HTMLElement}>} fieldElements - Resolved field elements.
 * @returns {Record<string, string|boolean>} Cue data derived from the form.
 */
export function gatherCueFormData(fieldElements) {
  const result = {};

  if (!Array.isArray(fieldElements)) {
    return result;
  }

  fieldElements.forEach(({ key, element }) => {
    const raw = readCueFieldValue(element);

    if (typeof raw === 'boolean') {
      result[key] = raw;
      return;
    }

    const trimmed = typeof raw === 'string' ? raw.trim() : raw;
    result[key] = trimmed === undefined || trimmed === null ? '' : trimmed;
  });

  return result;
}

/**
 * Escapes cue text content for safe HTML rendering.
 *
 * @param {unknown} value - The value to escape.
 * @returns {string} Escaped string value.
 */
export function escapeCueText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
