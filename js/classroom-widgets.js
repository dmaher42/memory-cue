const WIDGETS = [
  {
    id: 'timer',
    name: 'Timer',
    description: 'Count down or up to keep activities on schedule.',
    categories: ['Focus', 'Time Management'],
  },
  {
    id: 'noise-meter',
    name: 'Noise Meter',
    description: 'Visualizes classroom noise levels to encourage quieter work.',
    categories: ['Awareness', 'Classroom Climate'],
  },
  {
    id: 'name-picker',
    name: 'Name Picker',
    description: 'Randomly selects students to boost participation.',
    categories: ['Engagement'],
  },
  {
    id: 'qr-code',
    name: 'QR Code',
    description: 'Displays QR codes for quick resource sharing.',
    categories: ['Resources'],
  },
  {
    id: 'drawing-tool',
    name: 'Drawing Tool',
    description: 'Lightweight whiteboard for quick sketches.',
    categories: ['Collaboration', 'Visual'],
  },
  {
    id: 'instructions',
    name: 'Class Instructions',
    description: 'Pin reminders and expectations for the current activity.',
    categories: ['Awareness', 'Classroom Climate'],
  },
];

const PRESET_STORAGE_KEY = 'widgetPresets';

function safeReadPresets() {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Widget presets: unable to read storage', error);
    return [];
  }
}

function safeWritePresets(presets) {
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    console.warn('Widget presets: unable to write storage', error);
  }
}

function createWidgetManager() {
  const catalogContainer = document.getElementById('widgetCatalog');
  const searchInput = document.getElementById('widgetSearch');
  const categoryContainer = document.getElementById('categoryFilters');
  const layoutSlots = document.getElementById('layoutSlots');
  const layoutEmpty = document.getElementById('layoutEmpty');
  const clearLayoutButton = document.getElementById('clearLayout');
  const presetForm = document.getElementById('presetForm');
  const presetNameInput = document.getElementById('presetName');
  const presetList = document.getElementById('presetList');
  const presetsEmpty = document.getElementById('presetsEmpty');

  let selectedWidgets = [];
  let activeCategory = 'All';
  let presets = safeReadPresets();

  const allCategories = Array.from(
    new Set(WIDGETS.flatMap((widget) => widget.categories || []))
  ).sort();

  function renderCategories() {
    const categories = ['All', ...allCategories];
    categoryContainer.innerHTML = '';
    categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill';
      button.textContent = category;
      button.setAttribute('aria-pressed', category === activeCategory ? 'true' : 'false');
      button.addEventListener('click', () => {
        activeCategory = category;
        renderCategories();
        renderCatalog();
      });
      categoryContainer.appendChild(button);
    });
  }

  function matchesFilters(widget, query) {
    const matchesCategory =
      activeCategory === 'All' || (widget.categories || []).includes(activeCategory);
    if (!matchesCategory) return false;
    if (!query) return true;
    const term = query.toLowerCase();
    return (
      widget.name.toLowerCase().includes(term) ||
      widget.description.toLowerCase().includes(term) ||
      (widget.categories || []).some((cat) => cat.toLowerCase().includes(term))
    );
  }

  function renderCatalog() {
    const query = (searchInput.value || '').trim().toLowerCase();
    catalogContainer.innerHTML = '';
    const filtered = WIDGETS.filter((widget) => matchesFilters(widget, query));

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No widgets match your filters.';
      catalogContainer.appendChild(empty);
      return;
    }

    filtered.forEach((widget) => {
      const card = document.createElement('article');
      card.className = 'widget-card';

      const title = document.createElement('h3');
      title.textContent = widget.name;
      card.appendChild(title);

      const badgeRow = document.createElement('div');
      badgeRow.className = 'widget-badges';
      (widget.categories || []).forEach((cat) => {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = cat;
        badgeRow.appendChild(badge);
      });
      card.appendChild(badgeRow);

      const description = document.createElement('p');
      description.textContent = widget.description;
      card.appendChild(description);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-sm btn-primary';
      action.textContent = 'Add to layout';
      action.addEventListener('click', () => {
        selectedWidgets.push(widget.id);
        renderLayout();
      });
      card.appendChild(action);

      catalogContainer.appendChild(card);
    });
  }

  function renderLayout() {
    layoutSlots.innerHTML = '';
    if (!selectedWidgets.length) {
      layoutEmpty.hidden = false;
      return;
    }

    layoutEmpty.hidden = true;
    selectedWidgets.forEach((widgetId, index) => {
      const widget = WIDGETS.find((item) => item.id === widgetId);
      const container = document.createElement('div');
      container.className = 'layout-slot';

      const details = document.createElement('div');
      details.className = 'flex-1';
      const title = document.createElement('h3');
      title.className = 'font-semibold';
      title.textContent = widget ? widget.name : widgetId;
      details.appendChild(title);

      if (widget?.description) {
        const description = document.createElement('p');
        description.className = 'muted text-sm';
        description.textContent = widget.description;
        details.appendChild(description);
      }

      const controls = document.createElement('div');
      controls.className = 'flex items-center gap-2';

      const moveUp = document.createElement('button');
      moveUp.type = 'button';
      moveUp.className = 'btn btn-ghost btn-sm';
      moveUp.textContent = '↑';
      moveUp.title = 'Move up';
      moveUp.disabled = index === 0;
      moveUp.addEventListener('click', () => {
        selectedWidgets.splice(index - 1, 0, selectedWidgets.splice(index, 1)[0]);
        renderLayout();
      });

      const moveDown = document.createElement('button');
      moveDown.type = 'button';
      moveDown.className = 'btn btn-ghost btn-sm';
      moveDown.textContent = '↓';
      moveDown.title = 'Move down';
      moveDown.disabled = index === selectedWidgets.length - 1;
      moveDown.addEventListener('click', () => {
        selectedWidgets.splice(index + 1, 0, selectedWidgets.splice(index, 1)[0]);
        renderLayout();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm text-error';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        selectedWidgets.splice(index, 1);
        renderLayout();
      });

      controls.appendChild(moveUp);
      controls.appendChild(moveDown);
      controls.appendChild(remove);
      container.appendChild(details);
      container.appendChild(controls);
      layoutSlots.appendChild(container);
    });
  }

  function renderPresets() {
    presetList.innerHTML = '';
    if (!presets.length) {
      presetsEmpty.hidden = false;
      return;
    }

    presetsEmpty.hidden = true;
    presets.forEach((preset, index) => {
      const row = document.createElement('div');
      row.className = 'layout-slot bg-white';

      const details = document.createElement('div');
      details.className = 'flex-1';
      const title = document.createElement('h3');
      title.className = 'font-semibold';
      title.textContent = preset.name;
      details.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'muted text-sm';
      meta.textContent = `${preset.widgets.length} widget${preset.widgets.length === 1 ? '' : 's'}`;
      details.appendChild(meta);

      const buttons = document.createElement('div');
      buttons.className = 'flex items-center gap-2';

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn btn-primary btn-sm';
      apply.textContent = 'Apply';
      apply.addEventListener('click', () => {
        selectedWidgets = [...preset.widgets];
        renderLayout();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm text-error';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        presets.splice(index, 1);
        safeWritePresets(presets);
        renderPresets();
      });

      buttons.appendChild(apply);
      buttons.appendChild(remove);
      row.appendChild(details);
      row.appendChild(buttons);
      presetList.appendChild(row);
    });
  }

  function initEvents() {
    searchInput?.addEventListener('input', renderCatalog);
    clearLayoutButton?.addEventListener('click', () => {
      selectedWidgets = [];
      renderLayout();
    });

    presetForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = (presetNameInput.value || '').trim();
      if (!name || !selectedWidgets.length) {
        return;
      }
      presets = presets.filter((preset) => preset.name !== name);
      presets.push({ name, widgets: [...selectedWidgets] });
      safeWritePresets(presets);
      renderPresets();
      presetForm.reset();
      presetNameInput.focus();
    });
  }

  renderCategories();
  renderCatalog();
  renderLayout();
  renderPresets();
  initEvents();
}

function init() {
  if (typeof document === 'undefined') return;
  const appRoot = document.getElementById('widgetApp');
  if (!appRoot) return;
  createWidgetManager();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
