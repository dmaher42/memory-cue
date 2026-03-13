/*
LEGACY APP SHELL
This code belongs to the older Memory Cue UI.
It is not the primary runtime and should not be extended.
*/
(function () {
  const STORAGE_KEY = 'memoryCueState';
  const SCHEMA_VERSION = 1;

  const createDefaultState = () => ({
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    settings: {},
    ui: {
      activeTab: 'capture',
      filters: {}
    }
  });

  class MemoryCueStateStore {
    constructor() {
      this.state = createDefaultState();
    }

    load() {
      let parsed = null;

      try {
        const rawState = window.localStorage.getItem(STORAGE_KEY);
        if (!rawState) {
          this.state = createDefaultState();
          return this.state;
        }
        parsed = JSON.parse(rawState);
      } catch (error) {
        console.warn('MemoryCueState: Unable to load state from localStorage.', error);
        this.state = createDefaultState();
        return this.state;
      }

      this.state = this.migrate(parsed);
      return this.state;
    }

    save() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (error) {
        console.warn('MemoryCueState: Unable to save state to localStorage.', error);
      }
    }

    addEntry(entry) {
      const newEntry = {
        ...(entry || {}),
        id: this.generateId(),
        timestamp: new Date().toISOString()
      };

      this.state.entries.push(newEntry);
      this.save();
      return newEntry;
    }

    deleteEntry(id) {
      const originalLength = this.state.entries.length;
      this.state.entries = this.state.entries.filter((entry) => entry.id !== id);

      if (this.state.entries.length !== originalLength) {
        this.save();
      }
    }

    updateEntry(id, updates) {
      const entryIndex = this.state.entries.findIndex((entry) => entry.id === id);
      if (entryIndex === -1) {
        return null;
      }

      this.state.entries[entryIndex] = {
        ...this.state.entries[entryIndex],
        ...(updates || {})
      };

      this.save();
      return this.state.entries[entryIndex];
    }

    getEntries() {
      return [...this.state.entries].sort((a, b) => {
        const aTime = new Date(a.timestamp || 0).getTime();
        const bTime = new Date(b.timestamp || 0).getTime();
        return bTime - aTime;
      });
    }

    migrate(stateCandidate) {
      const baseState = createDefaultState();
      const source = stateCandidate && typeof stateCandidate === 'object' ? stateCandidate : {};
      const sourceVersion = Number(source.schemaVersion) || 0;

      let migratedState = {
        ...baseState,
        ...source,
        entries: Array.isArray(source.entries) ? source.entries : [],
        settings: source.settings && typeof source.settings === 'object' ? source.settings : {},
        ui: {
          ...baseState.ui,
          ...(source.ui && typeof source.ui === 'object' ? source.ui : {}),
          filters:
            source.ui && source.ui.filters && typeof source.ui.filters === 'object'
              ? source.ui.filters
              : {}
        }
      };

      // Placeholder for future schema migrations.
      if (sourceVersion < SCHEMA_VERSION) {
        migratedState = {
          ...migratedState,
          schemaVersion: SCHEMA_VERSION
        };
      }

      return migratedState;
    }

    generateId() {
      return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  const memoryCueState = new MemoryCueStateStore();
  memoryCueState.load();

  window.MemoryCueState = memoryCueState;
})();
