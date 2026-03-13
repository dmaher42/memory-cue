export const createChatComposer = ({
  textarea,
  button,
  onSubmit,
  maxHeight = 144,
} = {}) => {
  if (!(textarea instanceof HTMLTextAreaElement) || !(button instanceof HTMLElement)) {
    return null;
  }

  const autoResize = () => {
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 42)}px`;
  };

  textarea.addEventListener('input', autoResize);
  autoResize();

  const submit = async () => {
    if (typeof onSubmit !== 'function') {
      return;
    }
    await onSubmit();
    textarea.style.height = 'auto';
    autoResize();
  };

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    await submit();
  });

  textarea.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    await submit();
  });

  return {
    autoResize,
    submit,
  };
};
