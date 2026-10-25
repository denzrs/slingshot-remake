import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerSession, type Transport } from '../../src/net/multiplayer';
import { defaultRoomRules } from '../../src/data/roomRules';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { DEFAULT_ROOM_LOOK } from '../../src/data/roomLook';
import { ChatPanel, type ChatLocation } from '../../src/ui/room/chat';
import { h } from '../../src/ui/dom';

// Only the browser primitives are replaced. Tests exercise the real panel and session lifecycle.
const dom = vi.hoisted(() => {
  class Element extends EventTarget {
    hidden = false;
    disabled = false;
    value = '';
    textContent = '';
    tag = '';
    parentElement: Element | null = null;
    children: Array<Element | string> = [];
    scrollTop = 0;
    clientHeight = 100;
    scrollHeight = 100;
    classList = { toggle: vi.fn() };
    style = { setProperty: vi.fn() };
    attributes = new Map<string, string>();
    focus = vi.fn();
    blur = vi.fn();
    append(...children: Array<Element | string>) {
      this.children.push(...children);
      for (const child of children) if (typeof child !== 'string') child.parentElement = this;
    }
    replaceChildren(...children: Array<Element | string>) { this.children = []; this.append(...children); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    contains(target: Element | null): boolean { return this === target || this.children.some(child => typeof child !== 'string' && child.contains(target)); }
    querySelector(tag: string): Element | null {
      for (const child of this.children) {
        if (typeof child === 'string') continue;
        if (child.tag.split('.')[0] === tag) return child;
        const nested = child.querySelector(tag);
        if (nested) return nested;
      }
      return null;
    }
  }
  const element = (tag = '', attrs: Record<string, string> | null = null, ...children: Array<Element | string>) => {
    const el = new Element();
    el.tag = tag;
    for (const [key, value] of Object.entries(attrs ?? {})) el.setAttribute(key, value);
    el.append(...children);
    return el;
  };
  return { element };
});
vi.mock('../../src/ui/dom', () => ({ h: dom.element, eyeIcon: () => dom.element('svg') }));

let session: MultiplayerSession;
const transport: Transport = { address: '', setAddress() {}, connect: async () => {}, onMessage() {}, send() {}, close() {} };
beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, addEventListener() {} });
  const slot = dom.element('div.lobby__chat-slot');
  vi.stubGlobal('document', { createElementNS: dom.element, body: dom.element(), activeElement: null, slot, querySelector: (selector: string) => (selector === '.lobby__chat-slot' ? slot : null) });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  session = new MultiplayerSession({ settings: () => DEFAULT_SETTINGS, matchStarted() {}, matchRestarted() {}, matchEnded() {} }, transport);
  session.room = {
    ...DEFAULT_ROOM_LOOK, id: 'review', name: 'Room', number: 1, mode: 'ffa', gameMode: 'classic',
    rules: defaultRoomRules(), maxPlayers: 6, status: 'waiting', locked: false, spectators: [],
    players: [{ id: 0, name: 'Pilot', avatar: 'rocket', ready: false, team: 0, cpu: null }],
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('chat follows the visible online surface', () => {
  it('hides when leaving the online room screen, even while the session still owns that room', () => {
    const root = h('aside', null);
    let location: ChatLocation = { kind: 'lobby' };
    const panel: ChatPanel = new ChatPanel(root, session, () => location);
    panel.update();
    expect(root.hidden).toBe(false);
    // Menu navigation does not generate a network message or destroy the session.
    location = null;
    panel.update();
    expect(root.hidden).toBe(true);
    expect(session.room).not.toBeNull();
  });

  it('keeps chat hidden on Local, Daily, settings and the room browser', () => {
    const root = h('aside', null);
    const panel: ChatPanel = new ChatPanel(root, session, () => null);
    panel.update();
    expect(root.hidden).toBe(true);
  });

  it('docks in the lobby footer and floats over the online game', () => {
    const root = h('aside', null);
    let location: ChatLocation = { kind: 'lobby' };
    const panel = new ChatPanel(root, session, () => location);
    expect(root.hidden).toBe(true); // No flash before the first visibility update.
    panel.update();
    expect(root.parentElement).toBe((document as unknown as { slot: unknown }).slot);
    location = { kind: 'game' };
    panel.update();
    expect(root.parentElement).toBe(document.body);
  });

  it('keeps a draft while navigating, but clears it when joining a different room', () => {
    const root = h('aside', null);
    let location: ChatLocation = { kind: 'game' };
    const panel = new ChatPanel(root, session, () => location);
    panel.update();
    const input = root.querySelector('input')!;
    input.value = 'Next round?';
    location = null;
    panel.update();
    expect(input.value).toBe('Next round?');
    session.room = { ...session.room!, id: 'another-room' };
    location = { kind: 'game' };
    panel.update();
    expect(input.value).toBe('');
  });

  it('does not send a draft from a hidden panel', () => {
    const root = h('aside', null);
    let location: ChatLocation = { kind: 'game' };
    const panel = new ChatPanel(root, session, () => location);
    const send = vi.spyOn(session, 'sendChat');
    panel.update();
    const input = root.querySelector('input')!;
    const form = root.querySelector('form')!;
    input.value = 'Ready';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(send).toHaveBeenCalledExactlyOnceWith('Ready');
    location = null;
    panel.update();
    input.value = 'Hidden draft';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('opens from the game button and closes with Escape', () => {
    const root = h('aside', null);
    const panel = new ChatPanel(root, session, () => ({ kind: 'game' }));
    panel.update();
    const body = root.querySelector('div')!;
    expect(body.hidden).toBe(true);
    root.querySelector('button')!.dispatchEvent(new Event('click'));
    expect(body.hidden).toBe(false);
    const input = root.querySelector('input')!;
    Object.defineProperty(document, 'activeElement', { value: input, configurable: true });
    const blur = vi.spyOn(input, 'blur');
    root.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
    expect(body.hidden).toBe(true);
    expect(blur).toHaveBeenCalledOnce();
  });

  it('shows for an online game and hides immediately on leaving the room', () => {
    const root = h('aside', null);
    const panel: ChatPanel = new ChatPanel(root, session, () => ({ kind: 'game' }));
    panel.update();
    expect(root.hidden).toBe(false);
    session.leaveRoom();
    panel.update();
    expect(root.hidden).toBe(true);
  });
});
