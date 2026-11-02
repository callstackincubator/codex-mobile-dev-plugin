const picker = document.querySelector<HTMLDialogElement>('[data-install-picker]')!;
const triggers = document.querySelectorAll<HTMLButtonElement>('[data-install-open]');
const options = picker.querySelectorAll<HTMLAnchorElement>('[data-install-option]');
const firstOption = options[0]!;
const closeButton = picker.querySelector<HTMLButtonElement>('[data-install-close]')!;

const openPicker = () => {
  picker.showModal();
  firstOption.focus();
};
const closePicker = () => { picker.close(); };

for (const trigger of triggers) trigger.addEventListener('click', openPicker);
for (const option of options) option.addEventListener('click', closePicker);
closeButton.addEventListener('click', closePicker);
picker.addEventListener('click', event => {
  if (event.target === picker) closePicker();
});
window.addEventListener('pagehide', closePicker);

export {};
