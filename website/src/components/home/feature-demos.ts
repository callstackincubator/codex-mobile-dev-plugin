const controller = new AbortController();
const { signal } = controller;

for (const root of document.querySelectorAll<HTMLElement>('[data-recording-demo]')) {
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-recording-range]');
  const time = root.querySelector<HTMLElement>('[data-recording-time]');
  if (time === null) continue;

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const selected = button.dataset.recordingRange === 'selection';
      root.dataset.range = selected ? 'selection' : 'all';
      for (const control of buttons) {
        const pressed = control === button;
        const pressedValue = String(pressed);
        control.setAttribute('aria-pressed', pressedValue);
      }
      time.textContent = selected ? '4–7 s' : '0–12 s';
    }, { signal });
  }
}

for (const root of document.querySelectorAll<HTMLElement>('[data-storage-demo]')) {
  const button = root.querySelector<HTMLButtonElement>('[data-storage-toggle]');
  const before = root.querySelectorAll<HTMLElement>('[data-storage-before]');
  const after = root.querySelectorAll<HTMLElement>('[data-storage-after]');
  if (button === null) continue;

  button.addEventListener('click', () => {
    const showingChange = root.dataset.state === 'changed';
    const changed = showingChange === false;
    root.dataset.state = changed ? 'changed' : 'initial';
    const changedValue = String(changed);
    button.setAttribute('aria-pressed', changedValue);
    for (const value of before) value.hidden = changed;
    for (const value of after) value.hidden = changed === false;
  }, { signal });
}

window.addEventListener('pagehide', event => {
  if (event.persisted === false) controller.abort();
});

export {};
