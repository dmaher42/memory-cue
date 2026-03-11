import { DAILY_LOG_GROUPS, getDailyLog } from './modules/daily-log.js';

const getCurrentRoute = () => {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }
  const hash = window.location.hash || '#dashboard';
  const route = hash.startsWith('#') ? hash.slice(1) : hash;
  return route || 'dashboard';
};

const getTodayDateKey = () => {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateHeading = (dateValue) => {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
};

const renderDailyLog = () => {
  if (getCurrentRoute() !== 'daily-log') {
    return;
  }

  const todayDate = new Date();
  const entries = getDailyLog(getTodayDateKey());
  const grouped = {
    tasks: [],
    ideas: [],
    notes: [],
    knowledge: [],
  };

  entries.forEach((entry) => {
    const group = DAILY_LOG_GROUPS.includes(entry.group) ? entry.group : 'notes';
    grouped[group].push(entry);
  });

  const dateNode = document.getElementById('daily-log-date');
  if (dateNode) {
    dateNode.textContent = formatDateHeading(todayDate);
  }

  DAILY_LOG_GROUPS.forEach((group) => {
    const container = document.getElementById(`daily-log-${group}`);
    if (!container) {
      return;
    }

    container.innerHTML = '';
    const items = grouped[group];
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'text-base-content/70';
      empty.textContent = 'No entries';
      container.appendChild(empty);
      return;
    }

    items.forEach((entry) => {
      const row = document.createElement('li');
      row.textContent = entry.text;
      container.appendChild(row);
    });
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderDailyLog, { once: true });
} else {
  renderDailyLog();
}

window.addEventListener('hashchange', renderDailyLog);
