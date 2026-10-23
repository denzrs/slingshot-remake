import { COLORS } from '../config';
import { getLang, relayText, t } from '../i18n';
import type { MultiplayerSession } from '../multiplayer';
import { eyeIcon, h } from './dom';
import './chat.css';

const KEY = 'slingshot.chat.collapsed';

export type ChatLocation = { kind: 'lobby' } | { kind: 'game' } | null;

function remembered(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

function remember(collapsed: boolean): void {
  try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* Storage is optional. */ }
}

function icon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'chat__icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}
const bubbleIcon = () => icon('<path d="M4 5h16v11H10l-5 4v-4H4Z"/>');

/** One room channel, a widget that opens over the waiting room and over its online match. */
export class ChatPanel {
  private collapsed = remembered();
  private readonly unread = h('span.chat__unread', { 'aria-hidden': 'true' });
  private readonly toggle = h('button.chat__toggle', { type: 'button', 'aria-controls': 'chat-body' }, bubbleIcon(), h('span', null, t('chat.room')), this.unread);
  private readonly close = h('button.chat__close', { type: 'button', 'aria-label': t('chat.close'), title: t('chat.close') }, icon('<path d="m6 6 12 12M18 6 6 18"/>'));
  private readonly channel = h('span.chat__channel', null);
  private readonly log = h('ol.chat__log', { role: 'log', 'aria-label': t('chat.messages'), 'aria-live': 'polite', 'aria-relevant': 'additions text' });
  private readonly empty = h('div.chat__empty', null, bubbleIcon(), h('strong', null, t('chat.empty')), h('p', null, t('chat.emptyHint')));
  private readonly input = h('input.chat__input', { type: 'text', maxlength: '200', autocomplete: 'off', 'aria-label': t('chat.message') }) as HTMLInputElement;
  private readonly send = h('button.chat__send', { type: 'submit', 'aria-label': t('chat.send'), title: t('chat.send') }, icon('<path d="m4 4 17 8-17 8 4-8-4-8Zm4 8h13"/>')) as HTMLButtonElement;
  private readonly form = h('form.chat__form', null, this.input, this.send);
  private readonly body = h('div.chat__body', { id: 'chat-body' },
    h('div.chat__header', null, bubbleIcon(), h('div.chat__heading', null, h('h3', null, t('chat.room')), this.channel), this.close),
    this.empty, this.log, this.form,
  );
  private shown = '';
  private seen = 0;
  private roomId = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly session: MultiplayerSession,
    private readonly location: () => ChatLocation,
  ) {
    this.root.hidden = true;
    this.root.setAttribute('aria-label', t('chat.room'));
    this.toggle.addEventListener('click', () => this.expand(this.collapsed));
    this.close.addEventListener('click', () => this.expand(false));
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.expand(false);
    });
    this.input.addEventListener('input', () => { this.send.disabled = !this.session.canChat || !this.input.value.trim(); });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.root.hidden || !this.location() || !this.session.canChat || !this.input.value.trim()) return;
      this.session.sendChat(this.input.value);
      this.input.value = '';
      this.send.disabled = true;
      this.input.focus();
    });
    this.root.append(this.toggle, this.body);
  }

  private expand(open: boolean): void {
    this.collapsed = !open;
    remember(this.collapsed);
    this.update();
    if (open) this.input.focus();
    else if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur();
  }

  owns(target: EventTarget | null): boolean {
    return !this.root.hidden && target instanceof Node && this.root.contains(target);
  }

  /** The waiting room hosts the chat in its footer row; everywhere else it floats over the page. */
  private mount(lobby: boolean): void {
    const host = (lobby && document.querySelector<HTMLElement>('.lobby__chat-slot')) || document.body;
    if (this.root.parentElement !== host) host.append(this.root);
  }

  /** Called on navigation as well as relay messages; room membership alone never shows chat. */
  update(): void {
    const { room, chat, chatTotal, canChat } = this.session;
    const location = this.location();
    const visible = !!room && !!location;
    if (this.root.hidden === visible) this.root.hidden = !visible;
    this.mount(location?.kind === 'lobby');
    if (!room) {
      this.shown = '';
      this.seen = 0;
      this.roomId = '';
      this.input.value = '';
    }
    if (!visible) { this.shown = ''; return; }
    const collapsed = this.collapsed;
    if (room.id !== this.roomId) {
      this.roomId = room.id;
      this.input.value = '';
      this.seen = 0;
    }
    if (chatTotal < this.seen) this.seen = 0;
    if (!collapsed) this.seen = chatTotal;
    const key = `${room.id}|${room.name}|${location.kind}|${collapsed}|${canChat}|${chatTotal}|${getLang()}|${this.session.you.playerId}|${this.session.you.spectatorId}`;
    if (key === this.shown) return;
    this.shown = key;
    this.root.classList.toggle('is-lobby', location.kind === 'lobby');
    this.root.classList.toggle('is-collapsed', collapsed);
    this.toggle.hidden = !collapsed;
    this.body.hidden = collapsed;
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.setAttribute('aria-label', t('chat.open'));
    this.toggle.title = t('chat.open');
    const unread = chatTotal - this.seen;
    this.unread.hidden = !unread;
    this.unread.textContent = unread > 99 ? '99+' : String(unread);
    this.channel.textContent = room.name;
    this.input.disabled = !canChat;
    this.send.disabled = !canChat || !this.input.value.trim();
    this.input.placeholder = t(canChat ? 'chat.placeholder' : 'chat.readOnly');
    if (collapsed) return;

    const stuck = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 24;
    this.empty.hidden = chat.length > 0;
    this.log.hidden = chat.length === 0;
    this.log.replaceChildren(...chat.map((line) => {
      if (line.system) return h('li.chat__line.chat__line--system', null, relayText(line.text));
      const mine = line.spectator === !!this.session.you.spectator && line.id === (line.spectator ? this.session.you.spectatorId : this.session.you.playerId);
      const name = h(`span.chat__name${line.spectator ? '.chat__name--watcher' : ''}`, line.spectator ? { title: t('chat.watcher') } : null, ...(line.spectator ? [eyeIcon()] : []), line.name);
      if (!line.spectator) name.style.setProperty('--speaker-tone', COLORS.players[line.id % COLORS.players.length]);
      return h(`li.chat__line${mine ? '.chat__line--self' : ''}`, null, name, h('span.chat__text', null, line.text));
    }));
    if (stuck) this.log.scrollTop = this.log.scrollHeight;
  }
}
