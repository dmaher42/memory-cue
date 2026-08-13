import {
  createLessonCueFromNote,
  getActiveLessonNote,
  getLessonCueFields,
  getTeacherLessonContext,
  getTeacherLessonStep,
  getTeacherLessonSteps,
  isActiveLessonNoteId,
  setTeacherLessonStep,
  setActiveLessonNoteId,
} from '../services/teacherModeService.js';

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const NOTEBOOK_POLISH_STYLE_ID = 'memory-cue-notebook-polish';
const NOTEBOOK_POLISH_CSS = `
  #openSavedNotesGlobal,
  #view-notebook .note-actions-top {
    display: none !important;
  }

  #notesHeaderActions {
    display: none;
  }

  body[data-active-view="notebooks"] #reminders-slim-header {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
  }

  body[data-active-view="notebooks"] #reminders-slim-header #overflowMenuBtn {
    position: static;
    grid-column: 1;
    grid-row: 1;
  }

  body[data-active-view="notebooks"] #reminders-slim-header .header-title {
    grid-column: 2;
    grid-row: 1;
    justify-self: start;
    min-width: 0;
    font-size: 1rem;
    white-space: nowrap;
  }

  body[data-active-view="notebooks"] #notesHeaderActions:not([hidden]) {
    grid-column: 3;
    grid-row: 1;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.3rem;
    min-width: 0;
  }

  body[data-active-view="notebooks"] #notesHeaderActions .notes-overview-toggle,
  body[data-active-view="notebooks"] #notesHeaderActions .notes-header-action {
    width: auto;
    min-width: 0;
    min-height: 30px;
    height: 30px;
    padding: 0.28rem 0.58rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--mobile-header-button-border, rgba(30, 41, 59, 0.14)) 75%, transparent);
    background: color-mix(in srgb, var(--mobile-header-button-bg, #ffffff) 96%, #f8fafc 4%);
    color: var(--text-main, #1e293b);
    font-size: 0.7rem;
    line-height: 1;
    font-weight: 650;
    white-space: nowrap;
    box-shadow: none;
  }

  body[data-active-view="notebooks"] #notesHeaderActions .notes-header-action {
    color: color-mix(in srgb, var(--accent-color, #0f766e) 88%, #0f172a 12%);
    background: color-mix(in srgb, var(--accent-color, #0f766e) 10%, #ffffff 90%);
  }

  body[data-active-view="notebooks"] #notesHeaderActions .notes-overview-toggle:hover,
  body[data-active-view="notebooks"] #notesHeaderActions .notes-overview-toggle:focus-visible,
  body[data-active-view="notebooks"] #notesHeaderActions .notes-header-action:hover,
  body[data-active-view="notebooks"] #notesHeaderActions .notes-header-action:focus-visible {
    background: color-mix(in srgb, var(--accent-color, #0f766e) 14%, #ffffff 86%);
    color: var(--text-main, #1e293b);
    outline: none;
  }

  @media (max-width: 340px) {
    body[data-active-view="notebooks"] #reminders-slim-header {
      gap: 0.28rem;
      padding-inline: 0.5rem;
    }

    body[data-active-view="notebooks"] #notesHeaderActions {
      gap: 0.2rem;
    }

    body[data-active-view="notebooks"] #notesHeaderActions .notes-overview-toggle,
    body[data-active-view="notebooks"] #notesHeaderActions .notes-header-action {
      padding-inline: 0.46rem;
      font-size: 0.67rem;
    }
  }

  #view-notebook #notesOverviewPanel {
    padding: 0.32rem 0.52rem;
    margin: 0.16rem 0.7rem 0.12rem;
    border-radius: 0.78rem;
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: none;
  }

  #view-notebook #notesOverviewPanel > h2 {
    margin: 0;
    font-size: 0.9rem;
    letter-spacing: 0;
  }

  #view-notebook .notes-overview-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  #view-notebook .notes-overview-heading h2 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
    font-weight: 700;
    color: var(--text-main, #1e293b);
  }

  #view-notebook .notes-overview-search-shell {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    margin: 0.12rem 0 0.52rem;
  }

  #view-notebook .notes-overview-search-icon {
    position: absolute;
    left: 0.78rem;
    z-index: 1;
    color: color-mix(in srgb, var(--text-main, #1e293b) 48%, #7c8798 52%);
    font-size: 1rem;
    line-height: 1;
    pointer-events: none;
  }

  #view-notebook .notes-overview-search-input {
    width: 100%;
    min-height: 42px;
    padding: 0.62rem 0.85rem 0.62rem 2.35rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 82%, transparent);
    border-radius: 0.78rem;
    background: color-mix(in srgb, var(--surface-elevated, #ffffff) 97%, #f8fafc 3%);
    color: var(--text-main, #1e293b);
    font: inherit;
    font-size: 0.88rem;
    line-height: 1.2;
    outline: none;
    box-shadow: none;
  }

  #view-notebook .notes-overview-search-input::placeholder {
    color: color-mix(in srgb, var(--text-main, #1e293b) 46%, #94a3b8 54%);
  }

  #view-notebook .notes-overview-search-input:focus {
    border-color: color-mix(in srgb, var(--accent-color, #0f766e) 62%, #cbd5e1 38%);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color, #0f766e) 12%, transparent);
  }

  #view-notebook[data-notes-mode="notebooks"] #notesOverviewPanel {
    display: none;
  }

  #view-notebook[data-notes-mode="notebooks"] #notesOverviewList {
    display: none !important;
  }

  #view-notebook .notes-overview-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: 5.4rem;
    min-height: 24px;
    padding: 0.18rem 0.62rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    font-size: 0.72rem;
    line-height: 1;
    font-weight: 600;
    color: var(--text-main, #1e293b);
    white-space: nowrap;
  }

  #view-notebook #notesOverviewList {
    display: grid;
    gap: 0.36rem;
    margin-top: 0 !important;
  }

  #view-notebook #notesOverviewList[hidden] {
    display: none !important;
  }

  #view-notebook #notesOverviewList .notes-overview-recent-label,
  #view-notebook #notesOverviewList .notes-overview-categories-label,
  #view-notebook #notesOverviewList .notes-overview-results-summary {
    margin: 0.18rem 0.12rem 0.08rem;
    color: color-mix(in srgb, var(--text-main, #1e293b) 62%, #7c8798 38%);
    font-size: 0.72rem;
    line-height: 1.2;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  #view-notebook #notesOverviewList .notes-overview-recent,
  #view-notebook #notesOverviewList .notes-overview-recent-list {
    display: grid;
    gap: 0.36rem;
    min-width: 0;
  }

  #view-notebook #notesOverviewList .notes-overview-category {
    display: grid;
    gap: 0;
    min-width: 0;
    margin: 0;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 72%, transparent);
    border-radius: 0.78rem;
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    overflow: clip;
  }

  #view-notebook #notesOverviewList .notes-overview-category.is-expanded {
    border-color: color-mix(in srgb, var(--accent-color, #0f766e) 24%, var(--card-border, #e2e8f0));
  }

  #view-notebook #notesOverviewList .notes-overview-category-toggle {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 1.15rem;
    align-items: center;
    gap: 0.52rem;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 0.62rem 0.72rem;
    border: 0;
    border-radius: 0.72rem;
    background: transparent;
    color: var(--text-main, #1e293b);
    text-align: left;
  }

  #view-notebook #notesOverviewList .notes-overview-category-toggle:hover,
  #view-notebook #notesOverviewList .notes-overview-category-toggle:focus-visible {
    background: color-mix(in srgb, var(--accent-color, #0f766e) 8%, #ffffff 92%);
  }

  #view-notebook #notesOverviewList .notes-overview-category-toggle:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent-color, #0f766e) 65%, transparent);
    outline-offset: -2px;
  }

  #view-notebook #notesOverviewList .notes-overview-category-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main, #1e293b);
    font-size: 0.9rem;
    line-height: 1.25;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  #view-notebook #notesOverviewList .notes-overview-category-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.65rem;
    min-height: 1.35rem;
    padding: 0.08rem 0.38rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color, #0f766e) 9%, #f8fafc 91%);
    color: color-mix(in srgb, var(--text-main, #1e293b) 74%, #64748b 26%);
    font-size: 0.72rem;
    line-height: 1;
    font-weight: 700;
  }

  #view-notebook #notesOverviewList .notes-overview-category-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--text-main, #1e293b) 58%, #94a3b8 42%);
    font-size: 1.25rem;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 140ms ease;
  }

  #view-notebook #notesOverviewList .notes-overview-category.is-expanded .notes-overview-category-chevron {
    transform: rotate(90deg);
  }

  #view-notebook #notesOverviewList .notes-overview-category-content {
    display: grid;
    gap: 0.36rem;
    padding: 0 0.32rem 0.32rem;
  }

  #view-notebook #notesOverviewList .notes-overview-category-content[hidden] {
    display: none !important;
  }

  #view-notebook #notesOverviewList .notes-overview-category-empty {
    margin: 0;
    padding: 0.6rem 0.72rem 0.72rem;
    color: color-mix(in srgb, var(--text-main, #1e293b) 58%, #94a3b8 42%);
    font-size: 0.82rem;
    line-height: 1.35;
  }

  #view-notebook #notesOverviewList .notes-overview-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 36px;
    align-items: center;
    gap: 0.18rem;
    padding: 0.12rem;
    margin: 0;
    border-radius: 0.72rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: none;
  }

  #view-notebook #notesOverviewList .notes-overview-item:hover,
  #view-notebook #notesOverviewList .notes-overview-item:focus-within {
    background: color-mix(in srgb, #ffffff 91%, #f8fafc 9%);
    border-color: color-mix(in srgb, var(--accent-color, #1e293b) 18%, transparent);
    outline: none;
    box-shadow: none;
    transform: none;
  }

  #view-notebook #notesOverviewList .notes-overview-item.is-active {
    border-color: color-mix(in srgb, var(--accent-color, #1e293b) 32%, var(--card-border, #e2e8f0));
    background: color-mix(in srgb, var(--accent-color, #1e293b) 6%, #ffffff 94%);
    box-shadow: inset 3px 0 0 color-mix(in srgb, var(--accent-color, #1e293b) 72%, transparent);
  }

  #view-notebook #notesOverviewList .notes-overview-item-main {
    display: grid;
    min-width: 0;
    padding: 0.58rem 0.5rem 0.58rem 0.62rem;
    border: 0;
    border-radius: 0.6rem;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  #view-notebook #notesOverviewList .notes-overview-item-main:focus-visible,
  #view-notebook #notesOverviewList .notes-overview-item-actions:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent-color, #0f766e) 65%, transparent);
    outline-offset: 1px;
  }

  #view-notebook #notesOverviewList .notes-overview-item-title-row {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    min-width: 0;
  }

  #view-notebook #notesOverviewList .notes-overview-item-title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 0.9rem;
    line-height: 1.24;
    font-weight: 650;
    letter-spacing: 0;
  }

  #view-notebook #notesOverviewList .notes-overview-pinned-label {
    flex: 0 0 auto;
    margin-top: 0.08rem;
    padding: 0.15rem 0.38rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color, #0f766e) 10%, #ffffff 90%);
    color: color-mix(in srgb, var(--accent-color, #0f766e) 82%, #0f172a 18%);
    font-size: 0.62rem;
    line-height: 1;
    font-weight: 700;
  }

  #view-notebook #notesOverviewList .notes-overview-item-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: color-mix(in srgb, var(--text-main, #1e293b) 62%, #7c8798 38%);
    font-size: 1.2rem;
    line-height: 1;
  }

  #view-notebook #notesOverviewList .notes-overview-item-actions:hover,
  #view-notebook #notesOverviewList .notes-overview-item-actions:focus-visible {
    background: color-mix(in srgb, var(--accent-color, #0f766e) 10%, #ffffff 90%);
    color: var(--text-main, #1e293b);
  }

  body[data-active-view="notebooks"] #note-options-sheet .note-action-create-lesson-cue,
  body[data-active-view="notebooks"] #note-options-sheet .note-action-set-active-lesson {
    display: none !important;
  }

  #view-notebook [data-active-lesson-card] {
    margin-top: 0.55rem;
    margin-bottom: 0.4rem;
    border-radius: 1rem;
    background: color-mix(in srgb, #ffffff 96%, #f8fafc 4%);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
  }

  .mobile-panel--notes .scratch-notes-header-block {
    gap: 0.08rem;
    padding: 0.28rem 0.68rem 0.16rem;
    background: color-mix(in srgb, #ffffff 95%, #eef2f6 5%);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
  }

  .mobile-panel--notes .note-editor-actions-row {
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  #view-notebook #noteFolderPillMobile,
  #view-notebook [data-teacher-mode-toggle] {
    display: none !important;
  }

  #view-notebook [data-teacher-mode-toggle]::after {
    content: none !important;
  }

  .mobile-panel--notes .note-editor-actions-row .notes-overview-toggle {
    margin-left: auto;
  }

  .mobile-panel--notes #notebook-editor-body[data-placeholder]:empty::before {
    color: color-mix(in srgb, var(--text-main, #1e293b) 38%, transparent);
    font-style: normal;
  }

  #view-notebook .notes-overview-empty {
    display: grid;
    justify-items: start;
    gap: 0.38rem;
    padding: 1rem 0.2rem 0.75rem;
  }

  #view-notebook .notes-overview-empty-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-main, #1e293b);
  }

  #view-notebook .notes-overview-empty-copy {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: color-mix(in srgb, var(--text-main, #1e293b) 62%, #7c8798 38%);
  }

  #view-notebook .notes-overview-empty .note-inline-action {
    margin-top: 0.28rem;
  }

  .mobile-panel--notes #noteTitleMobile[hidden] {
    display: none !important;
  }

  .mobile-panel--notes .note-sections-bar {
    display: grid;
    gap: 0.14rem;
  }

  .mobile-panel--notes .note-sections-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    width: fit-content;
    min-height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--text-main, #1e293b) 60%, #7c8798 40%);
    white-space: nowrap;
  }

  .mobile-panel--notes .note-sections-toggle::after {
    content: '\\25BE';
    font-size: 0.62rem;
    opacity: 0.55;
    transition: transform 0.16s ease;
  }

  .mobile-panel--notes .note-sections-toggle[data-expanded="true"]::after {
    transform: rotate(180deg);
  }

  .mobile-panel--notes .note-sections-row {
    display: flex;
    gap: 0.24rem;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 0.08rem;
  }

  .mobile-panel--notes .note-editor-toolbar {
    margin-top: 0;
    gap: 0.24rem;
    padding-top: 0.12rem;
    padding-bottom: 0.1rem;
    overflow: visible;
  }

  .mobile-panel--notes .note-sections-row::-webkit-scrollbar {
    display: none;
  }

  .mobile-panel--notes .note-section-chip {
    flex: 0 0 auto;
    min-height: 26px;
    padding: 0.24rem 0.58rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 58%, transparent);
    background: color-mix(in srgb, #ffffff 98%, #f8fafc 2%);
    font-size: 0.7rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--text-main, #1e293b) 90%, #7c8798 10%);
    white-space: nowrap;
  }

  .mobile-panel--notes .note-section-chip[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #1e293b) 14%, #ffffff 86%);
    border-color: color-mix(in srgb, var(--accent-color, #1e293b) 30%, transparent);
    font-weight: 700;
  }

  .mobile-panel--notes #notebook-editor-body [data-note-section-hidden="true"] {
    display: none !important;
  }

  #view-notebook .note-inline-action {
    min-height: 28px;
    padding: 0.3rem 0.66rem;
    font-size: 0.74rem;
    background: color-mix(in srgb, #ffffff 96%, #f8fafc 4%);
    box-shadow: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] > div {
    border-color: color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  .mobile-panel--notes .teacher-toolbar-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-height: 2rem;
    padding: 0.38rem 0.74rem;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    color: var(--text-main, #1e293b);
  }

  .mobile-panel--notes .teacher-toolbar-toggle::after {
    content: '\\25BE';
    font-size: 0.72rem;
    opacity: 0.7;
  }

  .mobile-panel--notes .teacher-toolbar-toggle[data-expanded="true"]::after {
    transform: rotate(180deg);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-panel {
    padding: 0.4rem 0 0;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-shell {
    padding: 0.58rem 0.62rem;
    border-radius: 0.95rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-copy {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-section {
    display: grid;
    gap: 0.24rem;
    margin-top: 0.34rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-section--steps {
    position: sticky;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 4.8rem);
    z-index: 8;
    margin: 0.55rem -0.08rem 0;
    padding: 0;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-dock {
    display: grid;
    gap: 0.3rem;
    padding: 0.42rem 0.48rem;
    border-radius: 0.88rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 72%, transparent);
    background: color-mix(in srgb, #ffffff 90%, #f8fafc 10%);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.1);
    backdrop-filter: blur(12px);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-label {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action {
    min-height: 27px;
    padding: 0.28rem 0.58rem;
    font-size: 0.72rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #1e293b) 14%, #ffffff 86%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #1e293b) 30%, transparent);
    color: var(--text-main, #1e293b);
    font-weight: 600;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-row,
  #view-notebook [data-active-lesson-card] .teacher-step-row {
    display: flex;
    gap: 0.32rem;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 0.06rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-row::-webkit-scrollbar,
  #view-notebook [data-active-lesson-card] .teacher-step-row::-webkit-scrollbar {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-chip,
  #view-notebook [data-active-lesson-card] .teacher-step-chip {
    flex: 0 0 auto;
    min-height: 27px;
    padding: 0.26rem 0.54rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 68%, transparent);
    background: color-mix(in srgb, #ffffff 96%, #f8fafc 4%);
    font-size: 0.72rem;
    line-height: 1;
    color: var(--text-main, #1e293b);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-chip[data-selected="true"],
  #view-notebook [data-active-lesson-card] .teacher-step-chip[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #1e293b) 14%, #ffffff 86%);
    border-color: color-mix(in srgb, var(--accent-color, #1e293b) 34%, transparent);
    font-weight: 600;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] p {
    margin: 0;
  }

  .mobile-panel--notes .lesson-cue-note {
    display: grid;
    gap: 0.72rem;
    padding: 0.15rem 0;
  }

  .mobile-panel--notes .lesson-cue-block {
    padding: 0.78rem 0.9rem;
    border-radius: 0.95rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 68%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
  }

  .mobile-panel--notes .lesson-cue-label {
    margin: 0 0 0.28rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text-main, #1e293b) 62%, #7c8798 38%);
  }

  .mobile-panel--notes .lesson-cue-value {
    margin: 0;
    font-size: 1rem;
    line-height: 1.45;
    color: var(--text-main, #1e293b);
  }

  .mobile-panel--notes #scratch-notes-card .note-actions.fixed-bottom {
    gap: 0.6rem;
    padding: 0.52rem 0.6rem;
    background: color-mix(in srgb, #ffffff 94%, #f8fafc 6%);
    box-shadow: 0 10px 24px rgba(2, 6, 23, 0.1);
  }

  #view-notebook #relatedNotesPanel {
    margin: 0.35rem 0 0.1rem;
    padding-top: 0.85rem;
    border-top: 1px solid color-mix(in srgb, var(--card-border, #e2e8f0) 72%, transparent);
  }

  #view-notebook #relatedNotesPanel h3 {
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--text-main, #1e293b) 82%, #7c8798 18%);
  }

  #view-notebook #relatedNotesList {
    display: grid;
    gap: 0.38rem;
  }

  #savedNotesSheet .saved-notes-panel {
    background: color-mix(in srgb, #ffffff 97%, #f8fafc 3%);
    box-shadow: -10px 0 28px rgba(15, 23, 42, 0.18);
  }

  #savedNotesSheet .saved-notes-header {
    gap: 0.55rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--card-border, #e2e8f0) 70%, transparent);
  }

  #savedNotesSheet .saved-notes-list-shell {
    padding-top: 0.15rem;
  }

  #savedNotesSheet .saved-notes-list {
    gap: 0.2rem;
  }

  #savedNotesSheet .note-item-mobile {
    border-bottom-color: color-mix(in srgb, var(--text-secondary, #cbd5e1) 18%, transparent);
  }

  #savedNotesSheet .note-list-item {
    border-radius: 0.95rem;
    margin: 0.12rem 0;
    padding: 0.15rem 0.1rem;
    transition: background-color 0.18s ease, box-shadow 0.18s ease;
  }

  #savedNotesSheet .note-list-item:hover,
  #savedNotesSheet .note-list-item:focus-within {
    background: color-mix(in srgb, #ffffff 88%, #f8fafc 12%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--card-border, #e2e8f0) 54%, transparent);
  }

  #savedNotesSheet .note-card-title {
    font-size: 0.92rem;
    line-height: 1.35;
    font-weight: 600;
  }

  #savedNotesSheet .note-card-meta {
    gap: 0.38rem;
    margin-top: 0.2rem;
  }

  #savedNotesSheet .note-card-action {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    color: color-mix(in srgb, var(--text-main, #1e293b) 62%, #7c8798 38%);
  }

  #savedNotesSheet .note-card-action:hover,
  #savedNotesSheet .note-card-action:focus-visible {
    background: color-mix(in srgb, var(--accent-color, #1e293b) 10%, #ffffff 90%);
    color: var(--text-main, #1e293b);
  }

  @media (max-width: 899px) {
    body[data-active-view="notebooks"] #view-notebook {
      --notes-canvas-bg: #ffffff;
    }

    html[data-theme="dark"] body[data-active-view="notebooks"] #view-notebook,
    html[data-theme="professional-dark"] body[data-active-view="notebooks"] #view-notebook {
      --notes-canvas-bg: var(--surface-elevated, #172033);
    }

    body[data-active-view="notebooks"] #main {
      padding-bottom: 0 !important;
    }

    body[data-active-view="notebooks"] #view-notebook,
    body[data-active-view="notebooks"] #view-notebook .mobile-view-inner,
    body[data-active-view="notebooks"] #noteEditorSheet,
    body[data-active-view="notebooks"] #scratch-notes-card,
    body[data-active-view="notebooks"] .note-editor-card,
    body[data-active-view="notebooks"] .note-editor-inner,
    body[data-active-view="notebooks"] .note-content-wrapper {
      background: var(--notes-canvas-bg, #ffffff) !important;
    }

    body[data-active-view="notebooks"] #view-notebook,
    body[data-active-view="notebooks"] #view-notebook .mobile-view-inner,
    body[data-active-view="notebooks"] #noteEditorSheet,
    body[data-active-view="notebooks"] #scratch-notes-card {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    body[data-active-view="notebooks"] #view-notebook[data-notes-mode="overview"] {
      padding-bottom: calc(
        var(--mobile-bottom-nav-height, 48px)
        + 0.75rem
        + env(safe-area-inset-bottom, 0px)
      ) !important;
    }

    body[data-active-view="notebooks"] .note-editor-card {
      flex: 0 0 auto;
      width: 100%;
      min-height: 0;
      margin: 0;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    body[data-active-view="notebooks"] .scratch-notes-header-block {
      display: none !important;
    }

    body[data-active-view="notebooks"] .note-editor-toolbar {
      position: relative;
      top: auto;
      width: 100%;
      margin: 0 !important;
      padding: 0.58rem 0.75rem 0.66rem !important;
      gap: 0.3rem;
      border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--card-border, rgba(30, 41, 59, 0.14)) 58%, transparent);
      border-radius: 0;
      background: var(--notes-canvas-bg, #ffffff);
      box-shadow: none;
      backdrop-filter: none;
    }

    body[data-active-view="notebooks"] .note-editor-toolbar .rte-divider {
      display: none;
    }

    body[data-active-view="notebooks"] .note-editor-toolbar .rte-btn,
    body[data-active-view="notebooks"] .note-editor-toolbar .rte-select,
    body[data-active-view="notebooks"] .note-editor-toolbar .rte-menu-trigger,
    body[data-active-view="notebooks"] .note-editor-toolbar .rte-more-trigger {
      min-height: 30px;
      height: 30px;
    }

    body[data-active-view="notebooks"] .note-content-wrapper,
    body[data-active-view="notebooks"] .note-editor-content-wrapper,
    body[data-active-view="notebooks"] .scratch-notes-body-wrapper {
      flex: 0 0 calc(100dvh - 151px);
      width: 100%;
      height: calc(100dvh - 151px);
      min-height: 0;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      overflow: hidden;
    }

    body[data-active-view="notebooks"] .note-editor-inner {
      flex: 0 0 auto;
      min-height: 0;
    }

    body[data-active-view="notebooks"] #notebook-editor-body {
      flex: 0 0 calc(100dvh - 151px);
      width: 100%;
      height: calc(100dvh - 151px) !important;
      min-height: calc(100dvh - 151px);
      max-height: none !important;
      margin: 0 !important;
      padding: 1.2rem 1.25rem calc(1.75rem + env(safe-area-inset-bottom, 0px)) !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: var(--notes-canvas-bg, #ffffff) !important;
      box-shadow: none !important;
      overflow-x: hidden;
      overflow-y: auto;
      scroll-padding-bottom: 1.75rem;
      font-size: 17px;
      line-height: 1.58;
    }

    body[data-active-view="notebooks"] #notebook-editor-body p {
      margin: 0 0 1rem;
    }

    @media (max-width: 340px) {
      body[data-active-view="notebooks"] .note-editor-toolbar {
        padding-inline: 0.62rem !important;
        gap: 0.18rem;
      }

      body[data-active-view="notebooks"] #notebook-editor-body {
        padding-inline: 1rem !important;
      }
    }
  }
`;

export const initMobileNotesShellUi = (options = {}) => {
  if (typeof document === 'undefined') {
    return {
      applyNotesMode: () => {},
      isSavedNotesSheetOpen: () => false,
      showSavedNotesSheet: () => {},
      hideSavedNotesSheet: () => {},
      openNoteOptionsMenu: () => {},
      closeNoteOptionsMenu: () => {},
      openFolderSelectorForNote: () => {},
      closeMoveFolderSheet: () => {},
      closeNoteFolderSheet: () => {},
    };
  }

  const {
    noteEditorSheet = null,
    notesOverviewPanel = null,
    savedNotesSheet = null,
    openSavedNotesButton = null,
    closeSavedNotesButton = null,
    folderSelectorEl = null,
    folderSelectorListEl = null,
    folderSelectorBackdrop = null,
    noteFolderSheet = null,
    noteFolderSheetBackdrop = null,
    noteFolderSheetList = null,
    noteFolderSheetClose = null,
    noteFolderButton = null,
    noteOptionsOverlay = null,
    noteOptionsSheet = null,
    noteActionCreateLessonCueBtn: initialNoteActionCreateLessonBtn = null,
    noteActionSetActiveLessonBtn: initialNoteActionSetActiveLessonBtn = null,
    noteActionMoveBtn = null,
    noteActionTogglePinBtn = null,
    noteActionDeleteBtn = null,
    getAllNotes = () => [],
    renderFilteredNotes = () => {},
    getCurrentEditingNoteFolderId = () => 'unsorted',
    setCurrentEditingNoteFolderId = () => {},
    getCurrentNoteId = () => null,
    getCurrentNoteSections = null,
    getCurrentTeacherView = () => 'plan',
    getCurrentFolderMoveNoteId = () => null,
    setCurrentFolderMoveNoteId = () => {},
    getCurrentMoveFolderSheetNoteId = () => null,
    setCurrentMoveFolderSheetNoteId = () => {},
    getFolderSelectorOnSelect = () => null,
    setFolderSelectorOnSelect = () => {},
    getActiveFolderSheetOpener = () => null,
    setActiveFolderSheetOpener = () => {},
    setAfterFolderCreated = () => {},
    getFolderOptions = () => [],
    getFolderNameById = () => 'No category',
    handleMoveNoteToFolder = () => {},
    openNewFolderDialog = () => {},
    closeOverflowMenu = () => {},
    handleDeleteNote = () => {},
    flushCurrentNote = () => {},
    refreshFromStorage = () => {},
    saveAllNotes = () => {},
    onOpenNoteOptionsMove = null,
    onOpenNoteFromDashboard = null,
    onOpenTeacherNoteView = null,
  } = options;

  let notesMode = 'notebooks';
  let savedNotesSheetHideTimeout = null;
  let savedNotesSheetFocusRestoreEl = null;
  let currentNoteOptionsNoteId = null;
  let currentNoteOptionsFocusRestoreEl = null;
  let notesOverviewCollapsed = true;
  let teacherEditorToolsExpanded = false;
  let teacherEditorToolsNoteId = '';
  let activeNoteSectionLabel = '';
  let collapsedNoteSectionLabel = '';
  let noteSectionsExpanded = false;
  let noteSectionsKey = '';
  let noteSectionsNoteId = '';
  let noteSectionsEventsBound = false;
  let noteSectionsInputRenderTimeoutId = null;
  let noteActionCreateLessonCueBtn = initialNoteActionCreateLessonBtn;
  let noteActionSetActiveLessonBtn = initialNoteActionSetActiveLessonBtn;

  const ensureNotebookPolishStyles = () => {
    if (!(document.head instanceof HTMLElement)) {
      return;
    }
    const existingStyle = document.getElementById(NOTEBOOK_POLISH_STYLE_ID);
    if (existingStyle instanceof HTMLStyleElement) {
      return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = NOTEBOOK_POLISH_STYLE_ID;
    styleEl.textContent = NOTEBOOK_POLISH_CSS;
    document.head.appendChild(styleEl);
  };

  ensureNotebookPolishStyles();

  const ensureSheetActionButton = (button, className, label, insertAfterSelector = null) => {
    if (button instanceof HTMLButtonElement) {
      return button;
    }
    const actionsEl = noteOptionsSheet?.querySelector('.note-options-actions');
    if (!(actionsEl instanceof HTMLElement)) {
      return null;
    }
    const existingButton = actionsEl.querySelector(`.${className}`);
    if (existingButton instanceof HTMLButtonElement) {
      return existingButton;
    }
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = `note-action-btn ${className}`;
    nextButton.textContent = label;
    const insertAfterEl = insertAfterSelector ? actionsEl.querySelector(insertAfterSelector) : null;
    if (insertAfterEl?.nextSibling) {
      actionsEl.insertBefore(nextButton, insertAfterEl.nextSibling);
    } else {
      actionsEl.appendChild(nextButton);
    }
    return nextButton;
  };

  noteActionCreateLessonCueBtn = ensureSheetActionButton(
    noteActionCreateLessonCueBtn,
    'note-action-create-lesson-cue',
    'Create Lesson Cue',
    '.note-action-toggle-pin',
  );
  noteActionSetActiveLessonBtn = ensureSheetActionButton(
    noteActionSetActiveLessonBtn,
    'note-action-set-active-lesson',
    'Use as Active Lesson',
    '.note-action-create-lesson-cue',
  );

  const ensureTeacherModeEditorBar = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }

    const actionsRow = headerBlock.querySelector('.note-editor-actions-row');
    if (!(actionsRow instanceof HTMLElement)) {
      return null;
    }

    const existingBar = headerBlock.querySelector('[data-teacher-mode-editor-bar]');
    if (existingBar instanceof HTMLElement) {
      return existingBar;
    }

    const bar = document.createElement('div');
    bar.dataset.teacherModeEditorBar = 'true';
    bar.className = 'teacher-toolbar-host';
    actionsRow.insertAdjacentElement('afterend', bar);
    return bar;
  };

  const ensureTeacherModeToggleButton = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }
    const actionsRow = headerBlock.querySelector('.note-editor-actions-row');
    if (!(actionsRow instanceof HTMLElement)) {
      return null;
    }
    const existingButton = actionsRow.querySelector('[data-teacher-mode-toggle]');
    if (existingButton instanceof HTMLButtonElement) {
      return existingButton;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-inline-action teacher-toolbar-toggle';
    button.dataset.teacherModeToggle = 'true';
    button.textContent = 'Lesson';
    actionsRow.appendChild(button);
    return button;
  };

  const ensureNoteSectionsBar = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }

    const noteEditorCard = noteEditorSheet?.querySelector('.note-editor-card');
    const existingBars = noteEditorCard instanceof HTMLElement
      ? Array.from(noteEditorCard.querySelectorAll('[data-note-sections-bar]'))
      : Array.from(noteEditorSheet?.querySelectorAll('[data-note-sections-bar]') || []);
    const [existingBar, ...duplicateBars] = existingBars;
    duplicateBars.forEach((bar) => {
      if (bar instanceof HTMLElement) {
        bar.remove();
      }
    });

    if (existingBar instanceof HTMLElement) {
      return existingBar;
    }

    const bar = document.createElement('div');
    bar.dataset.noteSectionsBar = 'true';
    bar.className = 'note-sections-bar';
    if (noteEditorCard instanceof HTMLElement) {
      noteEditorCard.insertBefore(bar, headerBlock.nextSibling);
    } else {
      headerBlock.insertAdjacentElement('afterend', bar);
    }
    return bar;
  };

  const normalizeSectionLabel = (value = '') => String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-\u2013\u2014]+$/, '')
    .trim()
    .toLowerCase();

  const formatSectionLabel = (value = '') => normalizeSectionLabel(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  const extractEditorSectionInfo = (line = '') => {
    const trimmedLine = String(line || '').trim();
    if (!trimmedLine) {
      return null;
    }

    const markdownMatch = trimmedLine.match(/^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/);
    if (!markdownMatch?.[2]) {
      return null;
    }

    const label = formatSectionLabel(markdownMatch[2]);
    if (!label || label.length > 80) {
      return null;
    }

    return { label, kind: 'markdown' };
  };

  const extractEditorSectionLabel = (line = '') => extractEditorSectionInfo(line)?.label || '';

  const getEditorLineEntries = () => {
    const editorBody = document.getElementById('notebook-editor-body');
    if (!(editorBody instanceof HTMLElement)) {
      return [];
    }

    return Array.from(editorBody.childNodes || [])
      .map((node, index) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = String(node.textContent || '').trim();
          if (!text) {
            return null;
          }
          return {
            element: editorBody,
            index,
            text,
          };
        }

        if (node instanceof HTMLElement) {
          const text = String(node.innerText || node.textContent || '').trim();
          if (!text) {
            return null;
          }
          return {
            element: node,
            index,
            text,
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  const getOrderedEditorSectionMatches = (sections = []) => {
    const allowedLabels = Array.isArray(sections) && sections.length > 0
      ? new Set(
        sections
          .map((section) => normalizeSectionLabel(section?.label || section?.normalized || ''))
          .filter(Boolean),
      )
      : null;

    const entries = getEditorLineEntries();
    const matches = [];
    const seenLabels = new Set();

    entries.forEach((entry) => {
      const rawText = String(entry?.text || '').trim();
      if (!rawText) {
        return;
      }

      rawText
        .split(/\r?\n+/)
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .forEach((line, lineIndex) => {
          const sectionInfo = extractEditorSectionInfo(line);
          const label = sectionInfo?.label || '';
          const normalizedLabel = normalizeSectionLabel(label);
          if (!normalizedLabel || seenLabels.has(normalizedLabel)) {
            return;
          }
          if (allowedLabels && !allowedLabels.has(normalizedLabel)) {
            return;
          }

          seenLabels.add(normalizedLabel);
          matches.push({
            label,
            kind: sectionInfo?.kind || 'markdown',
            normalized: normalizedLabel,
            index: entry.index,
            lineIndex,
            order: matches.length,
            element: entry.element,
          });
        });
    });

    return matches;
  };

  const findSectionTargetElement = (label = '') => {
    const match = getOrderedEditorSectionMatches([{ label }])[0];
    return match?.element instanceof HTMLElement ? match.element : null;
  };

  const getNotebookEditorBody = () => {
    const editorBody = document.getElementById('notebook-editor-body');
    return editorBody instanceof HTMLElement ? editorBody : null;
  };

  const getNotebookEditorSourceText = () => {
    const editorBody = getNotebookEditorBody();
    if (!(editorBody instanceof HTMLElement)) {
      return '';
    }
    return editorBody.dataset.noteSectionFocusText
      || editorBody.innerText
      || editorBody.textContent
      || '';
  };

  const getNotebookSectionText = (bodyText = '', label = '') => {
    const normalizedTargetLabel = normalizeSectionLabel(label);
    if (!normalizedTargetLabel) {
      return '';
    }

    const lines = String(bodyText || '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    const startIndex = lines.findIndex((line) => {
      const sectionInfo = extractEditorSectionInfo(line);
      return normalizeSectionLabel(sectionInfo?.label || '') === normalizedTargetLabel;
    });
    if (startIndex === -1) {
      return '';
    }

    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (extractEditorSectionInfo(lines[index])) {
        endIndex = index;
        break;
      }
    }

    return lines
      .slice(startIndex, endIndex)
      .join('\n')
      .trimEnd();
  };

  const restoreNotebookEditorFromFocus = (editorBody) => {
    if (!(editorBody instanceof HTMLElement)) {
      return;
    }

    const focusedBody = editorBody.dataset.noteSectionFocusBody || '';
    if (focusedBody) {
      editorBody.innerHTML = focusedBody;
    }

    const previousContentEditable = editorBody.dataset.noteSectionPreviousContentEditable;
    if (typeof previousContentEditable === 'string' && previousContentEditable) {
      editorBody.contentEditable = previousContentEditable;
    } else {
      editorBody.contentEditable = 'true';
    }
    editorBody.setAttribute('aria-readonly', 'false');
    delete editorBody.dataset.noteSectionFocusBody;
    delete editorBody.dataset.noteSectionFocusLabel;
    delete editorBody.dataset.noteSectionFocusText;
    delete editorBody.dataset.noteSectionPreviousContentEditable;
    delete editorBody.dataset.noteSectionFocused;
  };

  const applyCollapsedNoteSection = (sections = []) => {
    const editorBody = getNotebookEditorBody();
    if (!(editorBody instanceof HTMLElement)) {
      return;
    }

    if (!collapsedNoteSectionLabel) {
      restoreNotebookEditorFromFocus(editorBody);
      return;
    }

    const normalizedTargetLabel = normalizeSectionLabel(collapsedNoteSectionLabel);
    const activeSection = (Array.isArray(sections) ? sections : []).find((section) => {
      const normalizedLabel = normalizeSectionLabel(section?.label || section?.normalized || '');
      return normalizedLabel === normalizedTargetLabel;
    });
    if (!activeSection) {
      collapsedNoteSectionLabel = '';
      restoreNotebookEditorFromFocus(editorBody);
      return;
    }

    const fullBody = editorBody.dataset.noteSectionFocusBody || editorBody.innerHTML || '';
    const fullText = editorBody.dataset.noteSectionFocusText || editorBody.innerText || editorBody.textContent || '';
    const focusedText = getNotebookSectionText(fullText, activeSection.label || activeSection.normalized || '');
    if (!focusedText) {
      collapsedNoteSectionLabel = '';
      restoreNotebookEditorFromFocus(editorBody);
      return;
    }

    if (!editorBody.dataset.noteSectionFocusBody) {
      editorBody.dataset.noteSectionFocusBody = fullBody;
      editorBody.dataset.noteSectionFocusText = fullText;
      editorBody.dataset.noteSectionPreviousContentEditable = editorBody.contentEditable || 'true';
    }
    editorBody.dataset.noteSectionFocusLabel = normalizedTargetLabel;
    editorBody.dataset.noteSectionFocused = 'true';
    editorBody.contentEditable = 'false';
    editorBody.setAttribute('aria-readonly', 'true');
    editorBody.textContent = focusedText;
  };

  const renderNoteSectionsBar = () => {
    const bar = ensureNoteSectionsBar();
    if (!(bar instanceof HTMLElement)) {
      return;
    }

    const currentNoteId = String(getCurrentNoteId() || '');
    if (noteSectionsNoteId !== currentNoteId) {
      noteSectionsNoteId = currentNoteId;
      activeNoteSectionLabel = '';
      collapsedNoteSectionLabel = '';
      noteSectionsExpanded = false;
      noteSectionsKey = '';
    }

    let sharedSections = null;
    if (typeof getCurrentNoteSections === 'function') {
      try {
        sharedSections = getCurrentNoteSections();
      } catch {
        sharedSections = null;
      }
    }
    const renderableSections = (Array.isArray(sharedSections)
      ? sharedSections
      : getNotebookEditorSourceText()
        .split(/\r?\n+/)
        .map((line) => extractEditorSectionInfo(line))
        .filter(Boolean))
      .map(({ label, kind }) => ({
        label,
        normalized: normalizeSectionLabel(label || ''),
        kind: kind || 'markdown',
      }))
      .filter((section) => Boolean(section.normalized));
    const renderableSectionsKey = renderableSections
      .map((section) => section.normalized || normalizeSectionLabel(section.label || ''))
      .join('|');
    if (renderableSections.length < 1) {
      activeNoteSectionLabel = '';
      noteSectionsExpanded = false;
      noteSectionsKey = '';
      collapsedNoteSectionLabel = '';
      applyCollapsedNoteSection([]);
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    const nextSectionsKey = renderableSectionsKey;
    if (noteSectionsKey !== nextSectionsKey) {
      noteSectionsKey = nextSectionsKey;
      noteSectionsExpanded = renderableSections.length === 1;
    }

    const normalizedSectionLabels = renderableSections
      .map((section) => section.normalized || normalizeSectionLabel(section.label || ''))
      .filter(Boolean);
    if (!normalizedSectionLabels.includes(activeNoteSectionLabel)) {
      activeNoteSectionLabel = normalizedSectionLabels[0] || '';
    }
    if (collapsedNoteSectionLabel && !normalizedSectionLabels.includes(collapsedNoteSectionLabel)) {
      collapsedNoteSectionLabel = '';
    }

    applyCollapsedNoteSection(renderableSections);

    bar.hidden = false;
    bar.innerHTML = `
      <button
        type="button"
        class="note-sections-toggle"
        data-note-sections-toggle="true"
        data-expanded="${noteSectionsExpanded ? 'true' : 'false'}"
      >Sections</button>
      ${noteSectionsExpanded ? `
        <div class="note-sections-row">
          ${collapsedNoteSectionLabel ? `
            <button
              type="button"
              class="note-section-chip"
              data-note-section-clear="true"
            >All</button>
          ` : ''}
          ${renderableSections.map((section) => `
            <button
              type="button"
              class="note-section-chip"
              data-note-section-jump="${escapeHtml(section.label || '')}"
              data-selected="${(section.normalized || normalizeSectionLabel(section.label || '')) === activeNoteSectionLabel ? 'true' : 'false'}"
            >${escapeHtml(section.label || '')}</button>
          `).join('')}
        </div>
      ` : ''}
    `;
  };

  const scheduleNoteSectionsBarRender = () => {
    if (noteSectionsInputRenderTimeoutId) {
      window.clearTimeout(noteSectionsInputRenderTimeoutId);
    }
    noteSectionsInputRenderTimeoutId = window.setTimeout(() => {
      noteSectionsInputRenderTimeoutId = null;
      renderNoteSectionsBar();
    }, 250);
  };

  const findScrollContainer = (startEl) => {
    let current = startEl?.parentElement || null;
    while (current) {
      const styles = window.getComputedStyle(current);
      const overflowY = styles?.overflowY || '';
      if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const getOffsetWithinContainer = (target, container) => {
    let offset = 0;
    let current = target;
    while (current && current !== container) {
      offset += current.offsetTop || 0;
      current = current.offsetParent;
    }
    return offset;
  };

  const getNoteSectionScrollOffset = () => {
    const toolbar = noteEditorSheet?.querySelector('.note-editor-toolbar');
    const toolbarHeight = toolbar instanceof HTMLElement ? toolbar.getBoundingClientRect().height : 0;
    return toolbarHeight + 12;
  };

  const handleNoteSectionJump = (event) => {
    const sectionRoot = event.target instanceof HTMLElement
      ? event.target.closest('[data-note-sections-bar]')
      : null;
    if (!(sectionRoot instanceof HTMLElement)) {
      return;
    }

    const toggleButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-note-sections-toggle]')
      : null;
    if (toggleButton instanceof HTMLButtonElement) {
      event.preventDefault();
      noteSectionsExpanded = !noteSectionsExpanded;
      renderNoteSectionsBar();
      return;
    }

    const clearButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-note-section-clear]')
      : null;
    if (clearButton instanceof HTMLButtonElement) {
      event.preventDefault();
      collapsedNoteSectionLabel = '';
      renderNoteSectionsBar();
      return;
    }

    const jumpButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-note-section-jump]')
      : null;
    if (!(jumpButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    const targetLabel = jumpButton.dataset.noteSectionJump || '';
    if (!targetLabel) {
      return;
    }

    const normalizedTargetLabel = normalizeSectionLabel(targetLabel);
    activeNoteSectionLabel = normalizedTargetLabel;
    collapsedNoteSectionLabel = normalizedTargetLabel;
    renderNoteSectionsBar();
  };

  const bindNoteSectionsEvents = () => {
    if (!(noteEditorSheet instanceof HTMLElement) || noteSectionsEventsBound) {
      return;
    }
    noteEditorSheet.addEventListener('click', handleNoteSectionJump);
    noteSectionsEventsBound = true;
  };

  const renderTeacherModeEditorBar = () => {
    const bar = ensureTeacherModeEditorBar();
    const toggleButton = ensureTeacherModeToggleButton();
    if (!(bar instanceof HTMLElement) || !(toggleButton instanceof HTMLButtonElement)) {
      return;
    }

    const currentNoteId = getCurrentNoteId();
    const currentNote = currentNoteId
      ? getAllNotes().find((note) => note?.id === currentNoteId) || null
      : null;
    const currentTeacherNoteId = String(currentNote?.id || '');
    if (teacherEditorToolsNoteId !== currentTeacherNoteId) {
      teacherEditorToolsNoteId = currentTeacherNoteId;
      teacherEditorToolsExpanded = false;
    }
    const lessonContext = currentNote ? getTeacherLessonContext(currentNote, getAllNotes()) : null;
    const hasCurrentNote = Boolean(currentNote);
    const shouldShowTeacherTools = Boolean(
      hasCurrentNote
      && (
        lessonContext?.isTeachingNote
        || lessonContext?.isCueNote
        || lessonContext?.hasLessonPair
        || lessonContext?.cueNoteId
        || lessonContext?.sourceNoteId
      )
    );
    if (!shouldShowTeacherTools) {
      teacherEditorToolsExpanded = false;
      toggleButton.hidden = true;
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    toggleButton.hidden = false;
    toggleButton.dataset.expanded = teacherEditorToolsExpanded ? 'true' : 'false';
    bar.hidden = false;
    const sourceNoteId = lessonContext?.sourceNoteId || null;
    const cueNoteId = lessonContext?.cueNoteId || null;
    const currentTeacherView = getCurrentTeacherView() === 'cue' ? 'cue' : 'plan';
    const canShowPlanToggle = Boolean(sourceNoteId && (lessonContext?.isCueNote || lessonContext?.hasLessonPair));
    const canShowCueToggle = Boolean(cueNoteId || sourceNoteId);
    const lessonStepId = lessonContext ? getTeacherLessonStep(lessonContext.currentNote, getAllNotes()) : null;
    const stepTargetId = sourceNoteId || cueNoteId || currentNoteId || '';
    const cueLabel = cueNoteId ? 'Refresh Cue' : 'Create Cue';
    const activeLessonTargetId = sourceNoteId || currentNoteId || '';
    const activeLessonLabel = 'Active';
    const lessonStepMarkup = stepTargetId
      ? `
        <div class="teacher-toolbar-section teacher-toolbar-section--steps">
          <div class="teacher-step-dock">
            <div class="teacher-step-row">
            ${getTeacherLessonSteps().map((step) => `
              <button
                type="button"
                class="teacher-step-chip"
                data-teacher-mode-action="step"
                data-note-id="${escapeHtml(stepTargetId)}"
                data-step-id="${escapeHtml(step.id)}"
                data-selected="${lessonStepId === step.id ? 'true' : 'false'}"
              >${escapeHtml(step.label)}</button>
            `).join('')}
            </div>
          </div>
        </div>
      `
      : '';

    bar.innerHTML = `
      <div class="teacher-toolbar-panel"${teacherEditorToolsExpanded ? '' : ' hidden'}>
        <div class="teacher-toolbar-shell w-full rounded-xl border border-base-300 bg-base-100/80">
          <div class="teacher-toolbar-section">
            <div class="teacher-toolbar-row">
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="cue"
                ${hasCurrentNote ? `data-note-id="${escapeHtml(currentNote.id || '')}"` : 'disabled'}
              >${escapeHtml(cueLabel)}</button>
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="active"
                ${activeLessonTargetId ? `data-note-id="${escapeHtml(activeLessonTargetId)}"` : 'disabled'}
                ${activeLessonTargetId && isActiveLessonNoteId(activeLessonTargetId) ? 'data-selected="true"' : 'data-selected="false"'}
              >${escapeHtml(activeLessonLabel)}</button>
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="lesson-plan"
                ${canShowPlanToggle ? `data-note-id="${escapeHtml(sourceNoteId || '')}"` : 'disabled'}
                ${currentTeacherView === 'plan' ? 'data-selected="true"' : 'data-selected="false"'}
              >Lesson Plan</button>
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="lesson-cue"
                ${canShowCueToggle ? `data-note-id="${escapeHtml(cueNoteId || sourceNoteId || '')}"` : 'disabled'}
                ${cueNoteId ? '' : 'data-generate-cue="true"'}
                ${currentTeacherView === 'cue' && canShowCueToggle ? 'data-selected="true"' : 'data-selected="false"'}
              >Lesson Cue</button>
            </div>
          </div>
          ${lessonStepMarkup}
        </div>
      </div>
    `;
  };

  const handleTeacherModeEditorAction = async (event) => {
    const toggleButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-teacher-mode-toggle]')
      : null;
    if (toggleButton instanceof HTMLButtonElement) {
      event.preventDefault();
      teacherEditorToolsExpanded = !teacherEditorToolsExpanded;
      renderTeacherModeEditorBar();
      return;
    }

    const actionButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-teacher-mode-action]')
      : null;
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();

    const noteId = actionButton.dataset.noteId || '';
    if (!noteId) {
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'cue') {
      const cueNote = await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
      if (cueNote?.id && typeof onOpenTeacherNoteView === 'function') {
        onOpenTeacherNoteView(noteId, 'cue');
      }
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'active') {
      setActiveLessonNoteId(noteId);
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'step') {
      setTeacherLessonStep(noteId, actionButton.dataset.stepId || '', getAllNotes());
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'lesson-cue'
      && actionButton.dataset.generateCue === 'true') {
      const cueNote = await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
      if (cueNote?.id && typeof onOpenTeacherNoteView === 'function') {
        onOpenTeacherNoteView(noteId, 'cue');
      }
      return;
    }

    if ((actionButton.dataset.teacherModeAction === 'lesson-plan' || actionButton.dataset.teacherModeAction === 'lesson-cue')
      && noteId
      && typeof onOpenTeacherNoteView === 'function') {
      onOpenTeacherNoteView(noteId, actionButton.dataset.teacherModeAction === 'lesson-cue' ? 'cue' : 'plan');
    }
  };

  ensureTeacherModeEditorBar()?.addEventListener('click', (event) => {
    void handleTeacherModeEditorAction(event);
  });
  ensureTeacherModeToggleButton()?.addEventListener('click', (event) => {
    void handleTeacherModeEditorAction(event);
  });
  bindNoteSectionsEvents();

  const ensureNotesOverviewHeader = () => {
    if (!(notesOverviewPanel instanceof HTMLElement)) {
      return { headingEl: null, toggleEl: null, titleEl: null };
    }

    let headingEl = notesOverviewPanel.querySelector(':scope > .notes-overview-heading');
    let titleEl = headingEl instanceof HTMLElement
      ? headingEl.querySelector('h2')
      : notesOverviewPanel.querySelector(':scope > h2');
    if (!(titleEl instanceof HTMLElement)) {
      return { headingEl: null, toggleEl: null, titleEl: null };
    }
    if (!(headingEl instanceof HTMLElement)) {
      headingEl = document.createElement('div');
      headingEl.className = 'notes-overview-heading';
      notesOverviewPanel.insertBefore(headingEl, titleEl);
      headingEl.appendChild(titleEl);
    }

    let toggleEl = headingEl.querySelector('.notes-overview-toggle');
    if (!(toggleEl instanceof HTMLButtonElement)) {
      toggleEl = document.getElementById('notesHeaderActions')?.querySelector('[data-notes-overview-toggle]') || null;
    }
    if (!(toggleEl instanceof HTMLButtonElement)) {
      toggleEl = noteEditorSheet?.querySelector('[data-notes-overview-toggle]') || null;
    }
    if (!(toggleEl instanceof HTMLButtonElement)) {
      toggleEl = document.createElement('button');
      toggleEl.type = 'button';
      toggleEl.className = 'notes-overview-toggle';
      toggleEl.dataset.notesOverviewToggle = 'true';
      headingEl.appendChild(toggleEl);
    }

    return { headingEl, toggleEl, titleEl };
  };

  const appHeader = document.getElementById('reminders-slim-header');
  const appHeaderTitle = appHeader?.querySelector('.header-title');
  const notesHeaderActions = document.getElementById('notesHeaderActions');
  const newNoteButton = document.getElementById('newNoteMobile');
  const notesTabButton = document.getElementById('mobile-footer-notebooks');
  if (appHeaderTitle instanceof HTMLElement && !appHeaderTitle.dataset.defaultTitle) {
    appHeaderTitle.dataset.defaultTitle = appHeaderTitle.textContent?.trim() || 'Memory Cue';
  }

  const renderNotesAppHeader = () => {
    const activeView = document.body?.dataset.activeView || 'capture';
    const notesViewIsActive = activeView === 'notebooks';
    if (notesHeaderActions instanceof HTMLElement) {
      notesHeaderActions.hidden = !notesViewIsActive;
      notesHeaderActions.setAttribute('aria-hidden', notesViewIsActive ? 'false' : 'true');
    }
    if (appHeaderTitle instanceof HTMLElement && notesViewIsActive) {
      appHeaderTitle.textContent = notesMode === 'overview' ? 'Saved notes' : 'Notes';
    } else if (appHeaderTitle instanceof HTMLElement && activeView === 'capture') {
      appHeaderTitle.textContent = appHeaderTitle.dataset.defaultTitle || 'Memory Cue';
    }
  };

  const renderNotesOverviewToggle = () => {
    const { headingEl, toggleEl, titleEl } = ensureNotesOverviewHeader();
    const listEl = notesOverviewPanel?.querySelector('#notesOverviewList');
    if (
      !(headingEl instanceof HTMLElement)
      || !(toggleEl instanceof HTMLButtonElement)
      || !(titleEl instanceof HTMLElement)
      || !(listEl instanceof HTMLElement)
    ) {
      return;
    }
    const notebookView = notesOverviewPanel?.closest('#view-notebook');
    if (notebookView instanceof HTMLElement) {
      notebookView.dataset.notesMode = notesMode;
    }
    const editorActionsRow = noteEditorSheet?.querySelector('.note-editor-actions-row');
    const hasNotesHeader = notesHeaderActions instanceof HTMLElement;
    const toggleHost = hasNotesHeader
      ? notesHeaderActions
      : (notesMode === 'overview' || !(editorActionsRow instanceof HTMLElement) ? headingEl : editorActionsRow);
    if (toggleEl.parentElement !== toggleHost) {
      if (hasNotesHeader && newNoteButton instanceof HTMLElement) {
        toggleHost.insertBefore(toggleEl, newNoteButton);
      } else {
        toggleHost.appendChild(toggleEl);
      }
    }
    if (editorActionsRow instanceof HTMLElement) {
      editorActionsRow.hidden = hasNotesHeader;
    }
    notesOverviewCollapsed = notesMode !== 'overview';
    listEl.hidden = notesOverviewCollapsed;
    titleEl.textContent = notesMode === 'overview' ? 'Saved notes' : 'Notes';
    titleEl.classList.toggle('sr-only', hasNotesHeader || notesMode !== 'overview');
    toggleEl.textContent = notesMode === 'overview' ? 'Back' : 'Saved notes';
    toggleEl.setAttribute('aria-label', notesMode === 'overview' ? 'Back to note editor' : 'Open saved notes');
    toggleEl.setAttribute('aria-expanded', notesMode === 'overview' ? 'true' : 'false');
    toggleEl.setAttribute('aria-controls', 'notesOverviewList');
    renderNotesAppHeader();
  };

  const { toggleEl: notesOverviewToggle } = ensureNotesOverviewHeader();
  notesOverviewToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    applyNotesMode(notesMode === 'overview' ? 'notebooks' : 'overview');
  });
  newNoteButton?.addEventListener('click', () => {
    if (notesMode === 'overview') {
      applyNotesMode('notebooks');
    }
  });
  notesTabButton?.addEventListener('click', () => {
    applyNotesMode('overview', { source: 'notes-tab' });
  });
  window.addEventListener('memorycue:navigation:changed', renderNotesAppHeader);
  renderNotesOverviewToggle();

  const ensureActiveLessonCard = () => {
    if (!(notesOverviewPanel instanceof HTMLElement)) {
      return null;
    }

    const existingCard = notesOverviewPanel.querySelector('[data-active-lesson-card]');
    if (existingCard instanceof HTMLElement) {
      return existingCard;
    }

    const card = document.createElement('section');
    card.dataset.activeLessonCard = 'true';
    card.className = 'memory-glass-card-soft p-3 mt-2 mb-2 hidden';
    card.setAttribute('aria-hidden', 'true');
    const notesOverviewListEl = notesOverviewPanel.querySelector('#notesOverviewList');
    if (notesOverviewListEl instanceof HTMLElement) {
      notesOverviewPanel.insertBefore(card, notesOverviewListEl);
    } else {
      notesOverviewPanel.appendChild(card);
    }
    return card;
  };

  const renderActiveLessonCard = () => {
    const card = ensureActiveLessonCard();
    if (!(card instanceof HTMLElement)) {
      return;
    }
    card.classList.add('hidden');
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '';
  };

  const handleActiveLessonCardClick = (event) => {
    const actionButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-active-lesson-action]')
      : null;
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();

    if (actionButton.dataset.activeLessonAction === 'clear') {
      setActiveLessonNoteId(null);
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.activeLessonAction === 'step') {
      const noteId = actionButton.dataset.noteId || '';
      const stepId = actionButton.dataset.stepId || '';
      if (noteId && stepId) {
        setTeacherLessonStep(noteId, stepId, getAllNotes());
        refreshFromStorage({ preserveDraft: true });
      }
      return;
    }

    if (actionButton.dataset.activeLessonAction === 'open' && typeof onOpenNoteFromDashboard === 'function') {
      const noteId = actionButton.dataset.noteId || '';
      if (noteId) {
        onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
      }
    }
  };

  ensureActiveLessonCard()?.addEventListener('click', handleActiveLessonCardClick);

  const isVisibleFocusableElement = (element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('disabled')) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  const focusVisibleElement = (element) => {
    if (!isVisibleFocusableElement(element) || typeof element.focus !== 'function') {
      return false;
    }
    try {
      element.focus({ preventScroll: true });
      return true;
    } catch {
      try {
        element.focus();
        return true;
      } catch {
        return false;
      }
    }
  };

  const applyNotesMode = (mode = 'notebooks', options = {}) => {
    notesMode = mode === 'overview' ? 'overview' : 'notebooks';
    if (notesMode === 'overview') {
      flushCurrentNote();
      refreshFromStorage({ preserveDraft: true });
    }
    const notebookView = notesOverviewPanel?.closest('#view-notebook');
    if (notebookView instanceof HTMLElement) {
      notebookView.dataset.notesMode = notesMode;
    }
    if (notesOverviewPanel instanceof HTMLElement) {
      notesOverviewPanel.classList.remove('hidden');
    }
    if (noteEditorSheet instanceof HTMLElement) {
      noteEditorSheet.classList.toggle('hidden', notesMode === 'overview');
    }
    renderNotesOverviewToggle();
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
    const NotesModeEvent = document.defaultView?.CustomEvent;
    if (typeof NotesModeEvent === 'function') {
      document.dispatchEvent(new NotesModeEvent('memoryCue:notesModeChanged', {
        detail: {
          mode: notesMode,
          source: typeof options?.source === 'string' ? options.source : '',
        },
      }));
    }
  };

  const isSavedNotesSheetOpen = () => savedNotesSheet?.dataset.open === 'true';

  const showSavedNotesSheet = () => {
    if (!savedNotesSheet) {
      return;
    }
    savedNotesSheetFocusRestoreEl =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : openSavedNotesButton;
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
      savedNotesSheetHideTimeout = null;
    }
    savedNotesSheet.classList.remove('hidden');
    savedNotesSheet.dataset.open = 'true';
    savedNotesSheet.removeAttribute('inert');
    savedNotesSheet.setAttribute('aria-hidden', 'false');
    document.body.dataset.savedNotesOpen = 'true';
    document.documentElement.dataset.savedNotesOpen = 'true';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    try {
      renderFilteredNotes();
    } catch {
      /* ignore */
    }
  };

  const hideSavedNotesSheet = ({ focusTarget = null } = {}) => {
    if (!savedNotesSheet) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && savedNotesSheet.contains(activeElement)) {
      const safeFocusTarget = [
        focusTarget,
        savedNotesSheetFocusRestoreEl,
        openSavedNotesButton,
      ].find((candidate) => isVisibleFocusableElement(candidate));

      if (safeFocusTarget) {
        focusVisibleElement(safeFocusTarget);
      }

      if (document.activeElement instanceof HTMLElement && savedNotesSheet.contains(document.activeElement)) {
        if (typeof activeElement.blur === 'function') {
          try {
            activeElement.blur();
          } catch {
            /* ignore */
          }
        }
        if (safeFocusTarget) {
          focusVisibleElement(safeFocusTarget);
        }
      }

      if (
        document.activeElement instanceof HTMLElement
        && savedNotesSheet.contains(document.activeElement)
        && document.body instanceof HTMLElement
      ) {
        const hadTabIndex = document.body.hasAttribute('tabindex');
        if (!hadTabIndex) {
          document.body.setAttribute('tabindex', '-1');
        }
        focusVisibleElement(document.body);
        if (!hadTabIndex) {
          document.body.removeAttribute('tabindex');
        }
      }

      if (document.activeElement instanceof HTMLElement && savedNotesSheet.contains(document.activeElement)) {
        activeElement.blur();
      }
    }
    savedNotesSheet.dataset.open = 'false';
    savedNotesSheet.setAttribute('inert', '');
    savedNotesSheet.setAttribute('aria-hidden', 'true');
    delete document.body.dataset.savedNotesOpen;
    delete document.documentElement.dataset.savedNotesOpen;
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
    }
    savedNotesSheetHideTimeout = setTimeout(() => {
      savedNotesSheet?.classList.add('hidden');
    }, 200);
  };

  if (savedNotesSheet) {
    openSavedNotesButton?.addEventListener('click', (event) => {
      event.preventDefault();
      showSavedNotesSheet();
      const notesListMobileEl = document.getElementById('notesListMobile');
      if (notesListMobileEl) {
        notesListMobileEl.scrollTop = 0;
      }
    });
    closeSavedNotesButton?.addEventListener('click', (event) => {
      event.preventDefault();
      hideSavedNotesSheet({ focusTarget: openSavedNotesButton });
    });
    savedNotesSheet.addEventListener('click', (event) => {
      if (event.target === savedNotesSheet) {
        hideSavedNotesSheet();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isSavedNotesSheetOpen()) {
        hideSavedNotesSheet();
      }
    });
  }

  const isNoteOptionsOpen = () => noteOptionsSheet && noteOptionsSheet.classList.contains('open');

  const closeNoteOptionsMenu = ({ focusTarget = null } = {}) => {
    const activeElement = document.activeElement;
    const preferredFocusTarget =
      focusTarget instanceof HTMLElement && noteOptionsSheet?.contains(focusTarget)
        ? null
        : focusTarget;
    const restoreTarget = [
      preferredFocusTarget,
      currentNoteOptionsFocusRestoreEl,
      openSavedNotesButton,
      document.body,
    ].find((candidate) => isVisibleFocusableElement(candidate));

    if (activeElement instanceof HTMLElement && noteOptionsSheet?.contains(activeElement)) {
      if (restoreTarget) {
        focusVisibleElement(restoreTarget);
      }

      if (
        document.activeElement instanceof HTMLElement
        && noteOptionsSheet.contains(document.activeElement)
        && typeof activeElement.blur === 'function'
      ) {
        try {
          activeElement.blur();
        } catch {
          /* ignore */
        }
      }
    }

    currentNoteOptionsNoteId = null;
    currentNoteOptionsFocusRestoreEl = null;
    if (noteOptionsSheet) {
      noteOptionsSheet.classList.remove('open');
      noteOptionsSheet.setAttribute('inert', '');
      noteOptionsSheet.setAttribute('aria-hidden', 'true');
      noteOptionsSheet.removeAttribute('data-note-id');
    }
    if (noteOptionsOverlay) {
      noteOptionsOverlay.classList.remove('open');
      noteOptionsOverlay.setAttribute('inert', '');
      noteOptionsOverlay.setAttribute('aria-hidden', 'true');
    }
  };

  const handleNoteOptionsKeydown = (event) => {
    if (event.key === 'Escape' && isNoteOptionsOpen()) {
      event.preventDefault();
      closeNoteOptionsMenu();
    }
  };

  const openNoteOptionsMenu = (noteId, triggerEl = null) => {
    if (!noteId || !noteOptionsSheet || !noteOptionsOverlay) {
      return;
    }
    closeNoteOptionsMenu();
    closeOverflowMenu();
    currentNoteOptionsNoteId = noteId;
    currentNoteOptionsFocusRestoreEl =
      isVisibleFocusableElement(triggerEl) ? triggerEl : document.activeElement;
    const note = getAllNotes().find((item) => item.id === noteId);
    if (noteActionTogglePinBtn) {
      const isPinned = Boolean(note?.pinned);
      noteActionTogglePinBtn.textContent = isPinned ? 'Unpin' : 'Pin';
    }
    if (noteActionCreateLessonCueBtn) {
      const noteType = typeof note?.metadata?.noteType === 'string' ? note.metadata.noteType : '';
      noteActionCreateLessonCueBtn.textContent = noteType === 'lesson-cue' ? 'Refresh Lesson Cue' : 'Create Lesson Cue';
    }
    if (noteActionSetActiveLessonBtn) {
      noteActionSetActiveLessonBtn.textContent = isActiveLessonNoteId(noteId) ? 'Active Lesson' : 'Use as Active Lesson';
    }
    noteOptionsSheet.removeAttribute('inert');
    noteOptionsSheet.classList.add('open');
    noteOptionsSheet.setAttribute('aria-hidden', 'false');
    noteOptionsSheet.setAttribute('data-note-id', noteId);
    noteOptionsOverlay.removeAttribute('inert');
    noteOptionsOverlay.classList.add('open');
    noteOptionsOverlay.setAttribute('aria-hidden', 'false');
  };

  if (noteOptionsOverlay) {
    noteOptionsOverlay.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteActionMoveBtn) {
    noteActionMoveBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      const note = getAllNotes().find((item) => item.id === noteId);
      closeNoteOptionsMenu();
      if (!noteId) return;
      if (typeof onOpenNoteOptionsMove === 'function') {
        onOpenNoteOptionsMove(noteId, note, noteActionMoveBtn);
      }
    });
  }

  if (noteOptionsSheet && noteActionCreateLessonCueBtn) {
    noteActionCreateLessonCueBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      closeNoteOptionsMenu();
      if (!noteId) {
        return;
      }
      await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
    });
  }

  if (noteOptionsSheet && noteActionSetActiveLessonBtn) {
    noteActionSetActiveLessonBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      closeNoteOptionsMenu();
      if (!noteId) {
        return;
      }
      setActiveLessonNoteId(noteId);
      refreshFromStorage({ preserveDraft: true });
    });
  }

  if (noteOptionsSheet && noteActionTogglePinBtn) {
    noteActionTogglePinBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (!currentNoteOptionsNoteId) {
        return;
      }
      const existingNotes = getAllNotes();
      let changed = false;
      const updatedNotes = (Array.isArray(existingNotes) ? existingNotes : []).map((note) => {
        if (note && note.id === currentNoteOptionsNoteId) {
          changed = true;
          const nextPinned = !Boolean(note.pinned);
          return { ...note, pinned: nextPinned, updatedAt: new Date().toISOString() };
        }
        return note;
      });
      if (changed) {
        saveAllNotes(updatedNotes);
        refreshFromStorage({ preserveDraft: true });
      }
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteActionDeleteBtn) {
    noteActionDeleteBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (currentNoteOptionsNoteId) {
        handleDeleteNote(currentNoteOptionsNoteId);
      }
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteOptionsOverlay) {
    document.addEventListener('keydown', handleNoteOptionsKeydown);
  }

  const closeNoteFolderSheet = () => {
    if (noteFolderSheet) {
      noteFolderSheet.classList.remove('open');
      noteFolderSheet.setAttribute('aria-hidden', 'true');
    }
    if (noteFolderSheetBackdrop) {
      noteFolderSheetBackdrop.classList.remove('open');
      noteFolderSheetBackdrop.setAttribute('aria-hidden', 'true');
    }
    setCurrentMoveFolderSheetNoteId(null);
    document.removeEventListener('keydown', handleNoteFolderSheetKeydown);
    if (noteFolderSheetList) {
      noteFolderSheetList.innerHTML = '';
    }
    if (noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'false');
    }
  };

  const handleNoteFolderSelection = (folderId) => {
    const targetNoteId = getCurrentMoveFolderSheetNoteId() || getCurrentNoteId();
    const normalizedFolderId = folderId || 'unsorted';
    const noteExists = Boolean(
      targetNoteId && getAllNotes().some((note) => note && note.id === targetNoteId),
    );
    if (targetNoteId && noteExists) {
      handleMoveNoteToFolder(targetNoteId, normalizedFolderId);
    } else {
      setCurrentEditingNoteFolderId(normalizedFolderId);
      if (noteFolderButton instanceof HTMLElement) {
        noteFolderButton.textContent = getFolderNameById(normalizedFolderId) || 'No category';
      }
    }
    closeNoteFolderSheet();
  };

  const openNoteFolderSheetForNote = (noteId, options = {}) => {
    if (!noteFolderSheet || !noteFolderSheetList) {
      return false;
    }

    const { initialFolderId = null, triggerEl = null } = options;
    const activeNote = noteId ? getAllNotes().find((note) => note && note.id === noteId) || null : null;
    const activeFolderId =
      initialFolderId
      || (activeNote && typeof activeNote.folderId === 'string' && activeNote.folderId
        ? activeNote.folderId
        : getCurrentEditingNoteFolderId() || 'unsorted');
    const storedFolders = Array.isArray(getFolderOptions()) ? getFolderOptions() : [];
    const noCategoryFolder = {
      id: 'unsorted',
      name: storedFolders.find((folder) => String(folder?.id || '') === 'unsorted')?.name
        || 'No category',
      order: -1,
    };
    const sortedFolders = [
      noCategoryFolder,
      ...storedFolders.filter((folder) => folder && folder.id && folder.id !== 'unsorted'),
    ]
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    noteFolderSheetList.innerHTML = '';
    sortedFolders.forEach((folder) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'note-folder-row';
      row.dataset.folderId = folder.id || 'unsorted';
      row.tabIndex = 0;
      if (String(row.dataset.folderId) === String(activeFolderId)) {
        row.classList.add('is-current');
      }

      const label = document.createElement('span');
      label.className = 'note-folder-row-label';

      const name = document.createElement('span');
      name.className = 'note-folder-row-name';
      name.textContent = folder.name || String(folder.id || 'No category');

      label.appendChild(name);
      row.appendChild(label);
      noteFolderSheetList.appendChild(row);
    });

    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className = 'note-folder-row note-folder-row-new';
    newRow.tabIndex = 0;

    const prefix = document.createElement('span');
    prefix.className = 'note-folder-row-prefix';
    prefix.textContent = '+';

    const newName = document.createElement('span');
    newName.className = 'note-folder-row-name';
    newName.textContent = 'New folder';

    newRow.appendChild(prefix);
    newRow.appendChild(newName);
    noteFolderSheetList.appendChild(newRow);

    setCurrentMoveFolderSheetNoteId(noteId || null);
    setActiveFolderSheetOpener(triggerEl || document.activeElement);
    noteFolderSheet.classList.add('open');
    noteFolderSheet.setAttribute('aria-hidden', 'false');
    if (noteFolderSheetBackdrop) {
      noteFolderSheetBackdrop.classList.add('open');
      noteFolderSheetBackdrop.setAttribute('aria-hidden', 'false');
    }
    document.addEventListener('keydown', handleNoteFolderSheetKeydown);
    return true;
  };

  const handleCreateNewFolderFromSheet = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    setAfterFolderCreated((createdId) => {
      handleNoteFolderSelection(createdId || 'unsorted');
    });
    openNewFolderDialog();
  };

  const handleNoteFolderSheetKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNoteFolderSheet();
    }
  };

  if (noteFolderSheetList) {
    noteFolderSheetList.addEventListener('click', (event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest('.note-folder-row') : null;
      if (!row || !noteFolderSheetList.contains(row)) return;
      if (row.classList.contains('note-folder-row-new')) {
        handleCreateNewFolderFromSheet(event);
        return;
      }
      event.preventDefault();
      handleNoteFolderSelection(row.dataset.folderId || 'unsorted');
    });

    noteFolderSheetList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target instanceof HTMLElement ? event.target.closest('.note-folder-row') : null;
      if (!row || !noteFolderSheetList.contains(row)) return;
      if (row.classList.contains('note-folder-row-new')) {
        handleCreateNewFolderFromSheet(event);
        return;
      }
      event.preventDefault();
      handleNoteFolderSelection(row.dataset.folderId || 'unsorted');
    });
  }

  if (noteFolderSheetClose) {
    noteFolderSheetClose.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteFolderSheet();
    });
  }

  if (noteFolderSheetBackdrop) {
    noteFolderSheetBackdrop.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteFolderSheet();
    });
  }

  const closeMoveFolderSheet = () => {
    if (folderSelectorEl) {
      folderSelectorEl.classList.add('hidden');
      folderSelectorEl.setAttribute('aria-hidden', 'true');
    }
    if (folderSelectorListEl) {
      folderSelectorListEl.innerHTML = '';
    }
    setCurrentFolderMoveNoteId(null);
    setFolderSelectorOnSelect(null);
    setAfterFolderCreated(null);
    if (noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'false');
    }
    const activeFolderSheetOpener = getActiveFolderSheetOpener();
    if (activeFolderSheetOpener instanceof HTMLElement) {
      try {
        activeFolderSheetOpener.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    setActiveFolderSheetOpener(null);
  };

  const handleFolderSelection = (folderId) => {
    const normalized = folderId || 'unsorted';
    const folderSelectorOnSelect = getFolderSelectorOnSelect();
    if (folderSelectorOnSelect) {
      folderSelectorOnSelect(normalized);
      closeMoveFolderSheet();
      return;
    }

    const moveNoteId = getCurrentFolderMoveNoteId();
    const noteExists = Boolean(
      moveNoteId && getAllNotes().some((note) => note && note.id === moveNoteId),
    );
    if (moveNoteId && noteExists) {
      handleMoveNoteToFolder(moveNoteId, normalized);
    } else {
      setCurrentEditingNoteFolderId(normalized);
    }
    closeMoveFolderSheet();
  };

  const openFolderSelectorForNote = (noteId, options = {}) => {
    if (options?.triggerEl === noteFolderButton && openNoteFolderSheetForNote(noteId, options)) {
      if (noteFolderButton) {
        noteFolderButton.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    if (!folderSelectorEl || !folderSelectorListEl) {
      return;
    }

    const { onSelect = null, initialFolderId = null, triggerEl = null } = options;
    setCurrentFolderMoveNoteId(noteId || null);
    setFolderSelectorOnSelect(typeof onSelect === 'function' ? onSelect : null);
    setActiveFolderSheetOpener(triggerEl || document.activeElement);

    const folders = getFolderOptions();
    const storedUnsortedFolder = (Array.isArray(folders) ? folders : [])
      .find((folder) => folder && String(folder.id) === 'unsorted');
    const unsortedFolder = {
      id: 'unsorted',
      name: storedUnsortedFolder?.name || 'No category',
    };
    const activeNote = noteId ? getAllNotes().find((n) => n.id === noteId) || null : null;
    const activeFolderId =
      initialFolderId ||
      (activeNote && typeof activeNote.folderId === 'string' && activeNote.folderId
        ? activeNote.folderId
        : getCurrentEditingNoteFolderId() || 'unsorted');

    const sortedFolders = (Array.isArray(folders) ? folders : [])
      .filter((folder) => folder && folder.id && folder.id !== 'unsorted')
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const folderOptions = [unsortedFolder, ...sortedFolders];
    folderSelectorListEl.innerHTML = '';
    folderOptions.forEach((folder) => {
      const row = document.createElement('li');
      row.dataset.folderId = folder.id || 'unsorted';
      row.textContent = folder.name || String(folder.id);
      row.setAttribute('role', 'option');
      if (row.dataset.folderId === String(activeFolderId)) {
        row.setAttribute('aria-current', 'true');
      }
      folderSelectorListEl.appendChild(row);
    });

    folderSelectorEl.classList.remove('hidden');
    folderSelectorEl.setAttribute('aria-hidden', 'false');
    if (triggerEl === noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'true');
    }
  };

  if (folderSelectorListEl) {
    folderSelectorListEl.addEventListener('click', (event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest('li') : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });

    folderSelectorListEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target instanceof HTMLElement ? event.target.closest('li') : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });
  }

  if (folderSelectorBackdrop) {
    folderSelectorBackdrop.addEventListener('click', (event) => {
      event.preventDefault();
      closeMoveFolderSheet();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && folderSelectorEl && !folderSelectorEl.classList.contains('hidden')) {
      event.preventDefault();
      closeMoveFolderSheet();
    }
  });

  document.addEventListener('memoryCue:activeLessonUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
  });

  document.addEventListener('memoryCue:activeLessonStepUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
  });

  document.addEventListener('memoryCue:notesUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
  });

  noteEditorSheet?.addEventListener('input', () => {
    scheduleNoteSectionsBarRender();
  });

  noteEditorSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
      renderNoteSectionsBar();
    }, 0);
  });

  savedNotesSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
      renderActiveLessonCard();
      renderNoteSectionsBar();
    }, 0);
  });

  document.addEventListener('thinkingBar:openNote', (event) => {
    const noteId = event?.detail?.noteId;
    if (!noteId || typeof onOpenNoteFromDashboard !== 'function') {
      return;
    }
    onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
  });

  renderActiveLessonCard();
  renderTeacherModeEditorBar();
  renderNoteSectionsBar();

  return {
    applyNotesMode,
    isSavedNotesSheetOpen,
    showSavedNotesSheet,
    hideSavedNotesSheet,
    openNoteOptionsMenu,
    closeNoteOptionsMenu,
    openFolderSelectorForNote,
    closeMoveFolderSheet,
    closeNoteFolderSheet,
  };
};
