export function renderReminders() {
  document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated'));
}

export function initReminderUI() {
  const viewToggleMenu = document.getElementById('viewToggleMenu');
  const reminderList = document.getElementById('reminderList');

  if (viewToggleMenu && reminderList) {
    const viewButtons = Array.from(viewToggleMenu.querySelectorAll('[data-view]'));

    const getCurrentView = () => {
      if (reminderList.classList.contains('reminder-single-row')) return 'row';
      if (reminderList.classList.contains('grid-cols-2')) return 'grid';
      return 'list';
    };

    const applyView = (view) => {
      reminderList.classList.remove('grid-cols-2', 'space-y-3', 'reminder-single-row');
      if (view === 'grid') {
        reminderList.classList.add('grid-cols-2');
      } else if (view === 'row') {
        reminderList.classList.add('reminder-single-row');
      } else {
        reminderList.classList.add('space-y-3');
      }

      viewButtons.forEach((button) => {
        const isActive = button.dataset.view === view;
        button.setAttribute('aria-pressed', String(isActive));
      });
    };

    const initialView = getCurrentView();
    applyView(initialView);

    viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyView(button.dataset.view || 'list');
      });
    });

    const observer = new MutationObserver(() => {
      const currentView = getCurrentView();
      viewButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.view === currentView));
      });
    });

    observer.observe(reminderList, { childList: true });
  }

  const addBtn = document.getElementById('addReminderBtn');
  const addOptionsFab = document.getElementById('addOptionsFab');
  if (addBtn && addOptionsFab) {
    addBtn.addEventListener('click', function onToggle() {
      const isExpanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!isExpanded));
      addOptionsFab.classList.toggle('active');
      this.style.transform = !isExpanded ? 'rotate(45deg)' : 'rotate(0deg)';
    });
  }
}
