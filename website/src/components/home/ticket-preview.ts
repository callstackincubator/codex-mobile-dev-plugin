export function mountTicketPreview(root: HTMLElement, onOpenChange: (open: boolean) => void) {
  const trigger = root.querySelector<HTMLButtonElement>('[data-ticket-trigger]')!;
  const panel = root.querySelector<HTMLElement>('[data-ticket-preview]')!;
  let overTrigger = false;
  let overPanel = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const isOpen = () => panel.matches(':popover-open');
  const cancelClose = () => { clearTimeout(closeTimer); closeTimer = undefined; };
  const hide = () => {
    cancelClose();
    if (isOpen()) panel.hidePopover();
  };
  const position = () => {
    if (isOpen() === false) return;
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) { hide(); return; }
    const rightLimit = window.innerWidth - panel.offsetWidth - 16;
    const alignedLeft = rect.right - panel.offsetWidth;
    const requestedLeft = Math.max(16, alignedLeft);
    const left = Math.min(requestedLeft, rightLimit);
    const below = rect.bottom + 10;
    const bottomLimit = window.innerHeight - panel.offsetHeight - 16;
    const requestedTop = below > bottomLimit ? rect.top - panel.offsetHeight - 10 : below;
    const top = Math.max(16, requestedTop);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  const show = () => {
    cancelClose();
    if (isOpen() === false) panel.showPopover();
    position();
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      const focused = trigger.matches(':focus-visible');
      if (overTrigger || overPanel || focused) return;
      hide();
    }, 150);
  };
  const enterTrigger = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    overTrigger = true;
    show();
  };
  const leaveTrigger = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    overTrigger = false;
    scheduleClose();
  };
  const enterPanel = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    overPanel = true;
    cancelClose();
  };
  const leavePanel = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    overPanel = false;
    scheduleClose();
  };
  const focus = () => { if (trigger.matches(':focus-visible')) show(); };
  const toggle = (event: ToggleEvent) => {
    const open = event.newState === 'open';
    const expanded = String(open);
    trigger.setAttribute('aria-expanded', expanded);
    if (open) position();
    onOpenChange(open);
  };

  trigger.addEventListener('pointerenter', enterTrigger);
  trigger.addEventListener('pointerleave', leaveTrigger);
  trigger.addEventListener('focus', focus);
  trigger.addEventListener('blur', scheduleClose);
  panel.addEventListener('pointerenter', enterPanel);
  panel.addEventListener('pointerleave', leavePanel);
  panel.addEventListener('toggle', toggle);
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, { passive: true });

  return {
    isOpen,
    hide,
    dispose() {
      hide();
      trigger.removeEventListener('pointerenter', enterTrigger);
      trigger.removeEventListener('pointerleave', leaveTrigger);
      trigger.removeEventListener('focus', focus);
      trigger.removeEventListener('blur', scheduleClose);
      panel.removeEventListener('pointerenter', enterPanel);
      panel.removeEventListener('pointerleave', leavePanel);
      panel.removeEventListener('toggle', toggle);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position);
    },
  };
}
