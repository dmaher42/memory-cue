(function (global) {
  'use strict';

  const MS_IN_MINUTE = 60 * 1000;
  const MS_IN_HOUR = 60 * MS_IN_MINUTE;
  const MS_IN_DAY = 24 * MS_IN_HOUR;
  const MS_IN_WEEK = 7 * MS_IN_DAY;
  const MS_IN_MONTH = 30 * MS_IN_DAY;
  const MS_IN_YEAR = 365 * MS_IN_DAY;
  const DUE_SOON_THRESHOLD_MS = 36 * MS_IN_HOUR;

  const hasIntl = typeof Intl !== 'undefined';
  const dateTimeWithWeekdayFormatter = hasIntl
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const dateWithWeekdayFormatter = hasIntl
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const dateTimeFormatter = hasIntl
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const dateFormatter = hasIntl
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null;

  function coerceDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function formatDate(value, options = {}) {
    const date = coerceDate(value);
    if (!date) return '';
    const { includeWeekday = true, includeTime = true } = options;

    if (includeWeekday && includeTime && dateTimeWithWeekdayFormatter) {
      return dateTimeWithWeekdayFormatter.format(date);
    }
    if (includeWeekday && !includeTime && dateWithWeekdayFormatter) {
      return dateWithWeekdayFormatter.format(date);
    }
    if (!includeWeekday && includeTime && dateTimeFormatter) {
      return dateTimeFormatter.format(date);
    }
    if (!includeWeekday && !includeTime && dateFormatter) {
      return dateFormatter.format(date);
    }
    return date.toLocaleString();
  }

  function formatDueCountdown(value, now = new Date()) {
    const due = coerceDate(value);
    const current = coerceDate(now);
    if (!due || !current) return '';

    const diff = due.getTime() - current.getTime();
    const direction = diff === 0 ? 0 : diff > 0 ? 1 : -1;
    const abs = Math.abs(diff);

    if (abs < MS_IN_MINUTE) {
      if (direction < 0) return 'overdue by less than a minute';
      if (direction > 0) return 'due in under a minute';
      return 'due now';
    }

    const thresholds = [
      { limit: 45 * MS_IN_MINUTE, unit: 'minute', divisor: MS_IN_MINUTE },
      { limit: 36 * MS_IN_HOUR, unit: 'hour', divisor: MS_IN_HOUR },
      { limit: 14 * MS_IN_DAY, unit: 'day', divisor: MS_IN_DAY },
      { limit: 10 * MS_IN_WEEK, unit: 'week', divisor: MS_IN_WEEK },
      { limit: 18 * MS_IN_MONTH, unit: 'month', divisor: MS_IN_MONTH },
      { limit: Infinity, unit: 'year', divisor: MS_IN_YEAR },
    ];

    for (const { limit, unit, divisor } of thresholds) {
      if (abs < limit) {
        let count = Math.round(abs / divisor);
        if (count === 0) count = 1;
        const plural = count === 1 ? '' : 's';
        if (direction < 0) return `overdue by ${count} ${unit}${plural}`;
        if (direction > 0) return `due in ${count} ${unit}${plural}`;
        return 'due now';
      }
    }

    return '';
  }

  function getReminderStatus(dueDate, options = {}) {
    const { now = new Date(), soonThreshold = DUE_SOON_THRESHOLD_MS } = options;
    const due = coerceDate(dueDate);
    const current = coerceDate(now);

    const base = {
      label: 'Scheduled',
      statusClass: 'reminder-status--scheduled',
      state: 'scheduled',
      dueDate: due || null,
      countdownText: '',
      accessibleLabel: 'Reminder scheduled',
    };

    if (!due || !current) {
      return base;
    }

    const diff = due.getTime() - current.getTime();
    const countdownText = formatDueCountdown(due, current);

    if (diff < 0) {
      return {
        label: 'Overdue',
        statusClass: 'reminder-status--overdue',
        state: 'overdue',
        dueDate: due,
        countdownText,
        accessibleLabel: countdownText
          ? `Reminder overdue — ${countdownText}`
          : 'Reminder overdue',
      };
    }

    if (diff <= soonThreshold) {
      return {
        label: 'Due soon',
        statusClass: 'reminder-status--due-soon',
        state: 'due-soon',
        dueDate: due,
        countdownText,
        accessibleLabel: countdownText
          ? `Reminder due soon — ${countdownText}`
          : 'Reminder due soon',
      };
    }

    return {
      label: 'Scheduled',
      statusClass: 'reminder-status--scheduled',
      state: 'scheduled',
      dueDate: due,
      countdownText,
      accessibleLabel: countdownText
        ? `Reminder scheduled — ${countdownText}`
        : 'Reminder scheduled',
    };
  }

  function normaliseDetails(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).trim()).filter(Boolean).join(' • ');
    }
    if (typeof value === 'string') return value;
    return String(value);
  }

  function createTagElement(tag, item, onTagClick) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }
    if (!tag && tag !== 0) return null;
    const isObject = typeof tag === 'object' && tag !== null;
    const label = isObject
      ? tag.label || tag.name || tag.title || tag.text || tag.value
      : tag;
    if (!label && label !== 0) return null;

    const hasHref = isObject && typeof tag.href === 'string' && tag.href.length > 0;
    const element = document.createElement(hasHref ? 'a' : 'button');
    element.className = 'item-tag';
    element.textContent = String(label);

    if (hasHref) {
      element.href = tag.href;
      if (tag.target) element.target = tag.target;
      if (tag.rel) element.rel = tag.rel;
    } else {
      element.type = 'button';
      if (typeof onTagClick === 'function') {
        element.addEventListener('click', (event) => {
          event.preventDefault();
          onTagClick(tag, item, event);
        });
      }
    }

    if (isObject && tag.value != null) {
      element.dataset.tagValue = String(tag.value);
    } else {
      element.dataset.tagValue = String(label);
    }

    return element;
  }

  function createItemCard(item = {}, section = 'general', options = {}) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw new Error('createItemCard requires a DOM environment');
    }

    const { onTagClick, onCardClick, renderFooter } = options;
    const article = document.createElement('article');
    const classes = ['item-card', `item-card--${section}`];
    if (section === 'reminders') classes.push('reminder-card');
    article.className = classes.join(' ');
    article.dataset.section = section;
    if (item && item.id != null) {
      article.dataset.id = String(item.id);
    }

    const content = document.createElement('div');
    content.className = 'item-card__content';
    if (section === 'reminders') content.classList.add('reminder-card__content');

    const title = document.createElement('h3');
    title.className = 'item-card__title';
    const defaultTitle = section === 'reminders' ? 'Reminder' : 'Item';
    title.textContent = item.title || item.heading || defaultTitle;
    content.appendChild(title);

    const detailSource = item.details ?? item.description ?? item.summary ?? '';
    const detailText = normaliseDetails(detailSource);
    if (detailText) {
      const detailEl = document.createElement('p');
      detailEl.className = 'item-card__details';
      detailEl.textContent = detailText;
      content.appendChild(detailEl);
    }

    if (Array.isArray(item.tags) && item.tags.length) {
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'item-card__tags';
      item.tags.forEach((tag) => {
        const tagEl = createTagElement(tag, item, onTagClick);
        if (tagEl) tagsContainer.appendChild(tagEl);
      });
      if (tagsContainer.childElementCount > 0) {
        content.appendChild(tagsContainer);
      }
    }

    article.appendChild(content);

    if (section === 'reminders') {
      const statusInfo = getReminderStatus(item.dueDate);
      if (statusInfo.state) {
        article.dataset.reminderStatus = statusInfo.state;
      }

      const meta = document.createElement('div');
      meta.className = 'reminder-card__meta';

      const statusPill = document.createElement('span');
      statusPill.className = ['reminder-status', statusInfo.statusClass]
        .filter(Boolean)
        .join(' ');
      statusPill.textContent = statusInfo.label;
      if (statusInfo.accessibleLabel) {
        statusPill.setAttribute('aria-label', statusInfo.accessibleLabel);
      }
      meta.appendChild(statusPill);

      const duePrimary = document.createElement('time');
      duePrimary.className = 'reminder-card__due';
      if (statusInfo.dueDate instanceof Date) {
        duePrimary.dateTime = statusInfo.dueDate.toISOString();
        const formattedDue = formatDate(statusInfo.dueDate, {
          includeWeekday: true,
          includeTime: true,
        });
        if (formattedDue) {
          duePrimary.textContent = `Due ${formattedDue}`;
          duePrimary.setAttribute('aria-label', `Due ${formattedDue}`);
        } else {
          duePrimary.textContent = 'Due';
        }
      } else {
        duePrimary.textContent = 'No due date';
      }
      meta.appendChild(duePrimary);

      if (statusInfo.countdownText) {
        const countdownEl = document.createElement('span');
        countdownEl.className = 'reminder-card__countdown';
        countdownEl.textContent = statusInfo.countdownText;
        meta.appendChild(countdownEl);
      }

      article.appendChild(meta);
    }

    if (typeof onCardClick === 'function') {
      article.addEventListener('click', (event) => {
        if (event.target && event.target.closest && event.target.closest('.item-tag')) {
          return;
        }
        onCardClick(item, section, event);
      });
    }

    if (typeof renderFooter === 'function') {
      const footer = renderFooter(item, section);
      if (footer) {
        article.appendChild(footer);
      }
    }

    return article;
  }

  function renderItems(section, items = [], config = {}) {
    const {
      container,
      selector,
      onTagClick,
      onCardClick,
      renderFooter,
    } = config;

    const list = Array.isArray(items) ? items : [];
    const host = container
      || (typeof document !== 'undefined'
        ? document.querySelector(
            selector || `[data-section="${section}"]`
          )
        : null);

    if (!host) {
      return [];
    }

    const fragment = document.createDocumentFragment();
    const created = [];
    list.forEach((item) => {
      const card = createItemCard(item, section, {
        onTagClick,
        onCardClick,
        renderFooter,
      });
      created.push(card);
      fragment.appendChild(card);
    });

    host.replaceChildren(fragment);
    return created;
  }

  const api = {
    formatDate,
    formatDueCountdown,
    getReminderStatus,
    createItemCard,
    renderItems,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (global && typeof global === 'object') {
    const target = global.memoryBoard || {};
    Object.assign(target, api);
    global.memoryBoard = target;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : this
);
