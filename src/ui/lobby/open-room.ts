import { MAX_PLAYERS } from '../../config';
import { t } from '../../i18n';
import type { LobbyPrefs } from '../../lobbyPrefs';
import type { MultiplayerSession } from '../../multiplayer';
import type { RoomLook } from '../../roomLook';
import { sliderControl, type Env } from '../controls';
import { h } from '../menu';
import { lookDialog, roomIcon, visibilityControl, type LookDialog } from '../roomLook';
import type { App } from '../screens';
import { button, field, iconButton, passwordInput, secretField, textInput } from './widgets';

/** What opening a room needs of the lobby around it. */
export interface OpenRoomContext {
  app: App;
  session: MultiplayerSession;
  prefs: LobbyPrefs;
  save(): void;
  /** The player's name, which names the room when the field is left empty. */
  playerName: HTMLInputElement;
  /** The player's name, noted as sent; null (with a message) when empty. */
  takeName(): string | null;
  copyText(text: string, what: string, target: HTMLElement): Promise<void>;
  /** The room was asked for with this password, which the host will want to share. */
  onCreated(password: string): void;
}

export interface OpenRoom {
  /** The form: the room's symbol and name, who may come in, how many. */
  el: HTMLElement;
  /** Sends the request; it sits in the footer. */
  createButton: HTMLButtonElement;
  /** The dialog for the room's symbol and colour. */
  dialog: LookDialog;
}

/** The form to open a room with: a name and a symbol, who may come in, and how many. The game is the host's to pick once the room stands. */
export function createOpenRoom({ app, session, prefs, save, playerName, takeName, copyText, onCreated }: OpenRoomContext): OpenRoom {
  const sound = app.menu.sound;
  const password = passwordInput();
  const roomName = textInput('', { maxLength: 40, autocomplete: 'off', placeholder: t('multiplayer.roomNamePlaceholder', { name: playerName.value.trim() || t('multiplayer.host') }) });
  playerName.addEventListener('input', () => (roomName.placeholder = t('multiplayer.roomNamePlaceholder', { name: playerName.value.trim() || t('multiplayer.host') })));
  const env: Env = { sound, changed: () => {} };
  const capacity = sliderControl(
    {
      kind: 'slider',
      label: t('multiplayer.capacity'),
      steps: Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ value: i + 2, label: String(i + 2) })),
      get: () => prefs.capacity,
      set: (v) => (prefs.capacity = v as number),
      commit: save,
    },
    env,
  );

  /** The listing, symbol and colour of the room to come; remembered, and sent when the room is made. */
  const lookSave = (patch: Partial<RoomLook>) => {
    prefs.look = { ...prefs.look, ...patch };
    save();
    paintLookButton();
    dialog.refresh(prefs.look);
  };
  const visibility = visibilityControl(prefs.look, lookSave, { sound });
  const dialog = lookDialog(prefs.look, lookSave, { sound });
  /** The room's symbol in its colour, beside its name: a click opens the dialog to change both. */
  const lookButton = iconButton(t('multiplayer.lookTitle'), '');
  lookButton.classList.add('online-create__look');
  const paintLookButton = () => lookButton.replaceChildren(roomIcon(prefs.look.symbol, prefs.look.color));
  lookButton.addEventListener('click', () => dialog.open());
  paintLookButton();
  const createButton = button(t('multiplayer.create'), true);
  roomName.setAttribute('aria-label', t('multiplayer.roomName'));
  const el = h('section.online-create', null,
    h('div.lobby__field', null, h('span', null, t('multiplayer.roomSymbolName')), h('div.online-create__name', null, lookButton, roomName)),
    visibility.el,
    field(t('multiplayer.passwordOptional'), secretField(password, (copy) => void copyText(password.value, t('multiplayer.passwordCopied'), copy))),
    capacity.el,
  );

  createButton.addEventListener('click', () => {
    const name = takeName();
    if (!name) return;
    // An empty field names the room as its placeholder promised, in the player's language — not the relay's English default.
    session.createRoom({ name, roomName: roomName.value.trim() || roomName.placeholder, mode: 'ffa', gameMode: prefs.gameMode, rules: prefs.rules, maxPlayers: prefs.capacity, password: password.value, look: prefs.look, avatar: prefs.avatar });
    onCreated(password.value);
    password.value = '';
  });

  return { el, createButton, dialog };
}
