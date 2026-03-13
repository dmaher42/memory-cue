const createNode = (tag, styles = {}) => {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  return node;
};

export const createSystemStatusIndicator = () => {
  let hideTimer = null;

  const container = createNode('div', {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.78rem',
    lineHeight: '1.2',
    color: 'var(--fg)',
    background: 'color-mix(in srgb, var(--fg) 8%, transparent)',
    borderRadius: '999px',
    padding: '0.25rem 0.55rem',
    opacity: '0',
    transform: 'translateY(4px)',
    pointerEvents: 'none',
    transition: 'opacity 180ms ease, transform 180ms ease',
  });

  const icon = createNode('span', {
    fontWeight: '600',
  });
  icon.textContent = '✓';

  const text = createNode('span');
  text.textContent = '';

  const hide = () => {
    container.style.opacity = '0';
    container.style.transform = 'translateY(4px)';
  };

  const show = (response) => {
    const message = typeof response?.message === 'string' ? response.message.trim() : '';
    if (!message) {
      return;
    }

    text.textContent = message.replace(/[.!?]+$/, '');
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';

    if (hideTimer) {
      clearTimeout(hideTimer);
    }

    hideTimer = setTimeout(hide, 4000);
  };

  return {
    container,
    show,
  };
};
