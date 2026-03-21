export const createChatComposer = ({
  form,
  textarea,
  button,
  maxHeight = 144,
} = {}) => {
  if (!(textarea instanceof HTMLTextAreaElement) || !(button instanceof HTMLElement)) {
    return null;
  }

  if (textarea.dataset.chatComposerBound === 'true') {
    return {
      autoResize: () => {},
      submit: () => {},
    };
  }
  textarea.dataset.chatComposerBound = 'true';

  const autoResize = () => {
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 42)}px`;
  };

  textarea.addEventListener('input', autoResize);
  autoResize();

  const submit = () => {
    if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
      form.requestSubmit(button);
      return;
    }

    if (button instanceof HTMLElement && typeof button.click === 'function') {
      button.click();
      return;
    }

    textarea.style.height = 'auto';
    autoResize();
  };

  textarea.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submit();
  });

  return {
    autoResize,
    submit,
  };
};
