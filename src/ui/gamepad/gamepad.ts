import { PadMapper, type PadAction, type PadContext, type PadKey, type PadLike } from './mapping';

/** What the pad does in the game, in the style of the touch controls' handlers. */
export interface GamepadHandlers {
  /** Where the pad's input goes right now: a match, a menu, or (null) nowhere, e.g. while the chat has the keyboard. */
  context(): PadContext | null;
  /** The stick or the D-pad changed the aim by this much (for whoever is aiming: at a hot seat only the current player). */
  adjust(dAngle: number, dPower: number): void;
  /** A: fire, lock in, go on. */
  primary(): void;
  /** B or Start: pause, or think again while placing. */
  escape(): void;
  /** X: use the power-up. */
  power(): void;
  /** Y: skip the round. */
  skip(): void;
  /** Back: record the last killcam. */
  clip(): void;
  /** A key a menu understands, pressed by the pad. */
  key(key: PadKey, repeat: boolean): void;
  /** The pad was used: browsers want a touch before they play sound, and hints should speak of the pad. */
  touched(): void;
  /** A pad showed up (the browser only shows it after its first button) or went away. */
  connection(event: 'connected' | 'lost'): void;
}

/** Where the pads come from: `navigator.getGamepads` in a browser. */
export type PadSource = () => ArrayLike<PadLike | null | undefined>;

export const fromNavigator: PadSource = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []);

/**
 * Looks at the connected pads once per frame and hands what they ask for to the handlers. Only pads with the standard
 * layout take part. With more than one pad connected every one of them can aim — whose turn it is decides who is aimed.
 */
export class Gamepads {
  /** Off: a pad is still known (the settings show it) but nothing it does reaches the game. */
  enabled = true;
  private readonly mappers = new Map<number, PadMapper>();

  constructor(
    private readonly handlers: GamepadHandlers,
    private readonly source: PadSource = fromNavigator,
  ) {}

  /** Whether a pad with the standard layout is connected. */
  get connected(): boolean {
    return this.mappers.size > 0;
  }

  poll(now: number): void {
    const pads = new Map<number, PadLike>();
    const list = this.source();
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (pad?.connected && pad.mapping === 'standard') pads.set(i, pad);
    }
    const before = this.mappers.size;
    for (const index of [...this.mappers.keys()]) if (!pads.has(index)) this.mappers.delete(index);
    for (const index of pads.keys()) if (!this.mappers.has(index)) this.mappers.set(index, new PadMapper());
    // Told after the mappers are in place, so a handler asking `connected` hears the truth.
    if (before === 0 && this.mappers.size > 0) this.handlers.connection('connected');
    else if (before > 0 && this.mappers.size === 0) this.handlers.connection('lost');

    if (!this.enabled) {
      // Looked at all the same, so a button held while it was off is not a press when it goes on.
      for (const [index, pad] of pads) this.mappers.get(index)!.poll(pad, now, 'menu');
      return;
    }
    const context = this.handlers.context();
    for (const [index, pad] of pads) {
      const frame = this.mappers.get(index)!.poll(pad, now, context ?? 'menu');
      if (frame.active) this.handlers.touched();
      if (!context) continue;
      for (const action of frame.actions) this.run(action);
    }
  }

  private run(action: PadAction): void {
    const h = this.handlers;
    switch (action.kind) {
      case 'adjust':
        return h.adjust(action.dAngle, action.dPower);
      case 'primary':
        return h.primary();
      case 'escape':
        return h.escape();
      case 'power':
        return h.power();
      case 'skip':
        return h.skip();
      case 'clip':
        return h.clip();
      case 'key':
        return h.key(action.key, action.repeat);
    }
  }
}

/** The key event a menu gets for a press of the pad, on the row that has the focus, so the menu and its controls need no pad code of their own. */
export function padKeyEvent(key: PadKey, repeat: boolean): KeyboardEvent {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  return new KeyboardEvent('keydown', { key, code, repeat, bubbles: true, cancelable: true });
}

/** Presses a key of the menu as the pad. */
export function pressMenuKey(key: PadKey, repeat: boolean, doc: Document = document): void {
  (doc.activeElement ?? doc.body).dispatchEvent(padKeyEvent(key, repeat));
}
