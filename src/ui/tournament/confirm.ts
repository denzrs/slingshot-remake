import { h } from '../menu/menu';
import { button } from '../lobby/widgets';

export interface ConfirmDialog {
  el: HTMLElement;
  isOpen(): boolean;
  /** Ask; `yes` runs only when the player agrees. The safe answer has the focus. */
  ask(question: { title: string; text: string; yes: string; no: string; danger?: boolean }, yes: () => void): void;
  close(): void;
}

/** A question in the game's own look, where the browser's would break the page: a title, a sentence, two answers. */
export function confirmDialog(): ConfirmDialog {
  const title = h('h3.t-editor__title', null);
  const text = h('p.t-confirm__text', null);
  const no = button('');
  const yes = button('', true);
  let onYes: (() => void) | null = null;
  const panel = h('section.t-editor.t-confirm', { role: 'alertdialog', 'aria-modal': 'true' },
    title, text, h('footer.t-editor__foot', null, no, yes));
  const el = h('div.t-editor-backdrop', { hidden: 'hidden' }, panel);
  const close = () => { el.hidden = true; onYes = null; };
  no.addEventListener('click', close);
  yes.addEventListener('click', () => {
    const run = onYes;
    close();
    run?.();
  });
  el.addEventListener('click', (event) => { if (event.target === el) close(); });
  return {
    el,
    isOpen: () => !el.hidden,
    ask: (question, then) => {
      title.textContent = question.title;
      text.textContent = question.text;
      text.hidden = !question.text;
      no.textContent = question.no;
      yes.textContent = question.yes;
      yes.classList.toggle('t-confirm__danger', !!question.danger);
      onYes = then;
      el.hidden = false;
      no.focus();
    },
    close,
  };
}
