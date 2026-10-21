import { COLORS } from '../config';
import { t } from '../i18n';
import type { MultiplayerSession } from '../multiplayer';
import { eyeIcon, h } from './dom';

const KEY = 'slingshot.chat.collapsed';

/** The remembered choice, if there is one and storage works. */
function remembered(): boolean | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? null : value === '1';
  } catch {
    return null;
  }
}

function remember(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered; the chat still works.
  }
}

/** A speech bubble, drawn: an emoji is a blank square in fonts that lack it. */
function bubbleIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'chat__icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M4 5h16v11H10l-5 4v-4H4Z"/>';
  return svg;
}

/**
 * The chat of the room you are in: a transparent bar down the right edge that anybody in the room — players and
 * spectators — can read and write in, over the lobby's room and over the game alike. It folds away to a small tab, which
 * says when something new was said. The relay decides what gets through; this only shows it.
 */
export class ChatPanel {
  private collapsed: boolean;
  private readonly toggle = h('button.chat__toggle', { type: 'button', 'aria-controls': 'chat-body' });
  private readonly dot = h('span.chat__dot', null);
  private readonly log = h('ol.chat__log', { 'aria-live': 'polite' });
  private readonly input = h('input.chat__input', { type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  private readonly body = h('div.chat__body', { id: 'chat-body' }, this.log, h('form.chat__form', null, this.input));
  /** What is on screen now, so a redraw happens only when something changed. */
  private shown = '';
  private seen = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly session: MultiplayerSession,
  ) {
    this.collapsed = remembered() ?? window.innerWidth < 1100;
    this.toggle.append(bubbleIcon(), h('span.chat__title', null, t('chat.title')), this.dot);
    this.toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      remember(this.collapsed);
      this.shown = '';
      this.update();
      if (!this.collapsed) this.input.focus();
    });
    this.body.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.session.sendChat(this.input.value);
      this.input.value = '';
    });
    this.root.append(this.toggle, this.body);
  }

  /** Whether an event came from inside the chat: the game's keys have no business with it. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  /** Brings the panel up to date with the session; cheap enough to call on every message. */
  update(): void {
    const { room, chat, chatTotal, canChat } = this.session;
    this.root.hidden = !room;
    if (!room) {
      this.shown = '';
      this.seen = 0;
      return;
    }
    // Counted by the session, not taken from `chat.length`, which stops growing once the log is capped.
    if (chatTotal < this.seen) this.seen = 0;
    if (!this.collapsed) this.seen = chatTotal;
    const key = `${room.id}|${this.collapsed}|${canChat}|${chatTotal}|${chatTotal - this.seen}`;
    if (key === this.shown) return;
    this.shown = key;

    this.root.classList.toggle('is-collapsed', this.collapsed);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    this.toggle.title = this.collapsed ? t('chat.open') : t('chat.close');
    this.dot.hidden = !(this.collapsed && chatTotal > this.seen);
    this.body.hidden = this.collapsed;
    this.input.disabled = !canChat;
    this.input.placeholder = canChat ? t('chat.placeholder') : t('chat.readOnly');
    if (this.collapsed) return;

    const stuck = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 24;
    this.log.replaceChildren(
      ...chat.map((line) => {
        if (line.system) return h('li.chat__line.chat__line--system', null, line.text);
        const name = h(`span.chat__name${line.spectator ? '.chat__name--watcher' : ''}`, line.spectator ? { title: t('chat.watcher') } : null, ...(line.spectator ? [eyeIcon()] : []), line.name);
        if (!line.spectator) name.style.color = COLORS.players[line.id % COLORS.players.length];
        return h('li.chat__line', null, name, ' ', h('span.chat__text', null, line.text));
      }),
    );
    if (stuck) this.log.scrollTop = this.log.scrollHeight;
  }
}
