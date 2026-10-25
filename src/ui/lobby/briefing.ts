import { t, type Key } from '../../i18n';
import type { LobbyPrefs } from '../../lobbyPrefs';
import type { MultiplayerSession } from '../../multiplayer';
import type { RoomInfo, RoomRules } from '../../net';
import type { GameMode } from '../../modes';
import { rulesOf } from '../../roomRules';
import { buildControl, type Control } from '../controls';
import { h } from '../menu';
import { menuPage } from '../menu-page';
import { modeName } from '../mode-name';
import { powerUpSummary } from '../powerup-summary';
import { PresetCards, type PresetCard, type PresetCreator, type PresetSelection } from '../preset-cards';
import { presetNameField } from '../preset-name';
import { ruleItems } from '../rules';
import type { App } from '../screens';
import { rulesForm, type RulesForm } from './rules-form';


/** What the briefing needs of the lobby around it. */
export interface BriefingContext {
  app: App;
  session: MultiplayerSession;
  /** The lobby's remembered settings: the game and the rules the host sets up here are `gameMode` and `rules`. */
  prefs: LobbyPrefs;
  save(): void;
}

export interface Briefing {
  /** The preset cards and the quick controls, for the room's briefing. */
  el: HTMLElement;
  /** The link that opens all the rules: "adjust" for the host, "room rules" for everybody else. */
  setRulesLabel(text: string): void;
  /** Starts the lobby on the first preset of its game. */
  begin(): void;
  /** The game changed: starts on that game's first preset. */
  startGame(): void;
  /** Builds the cards and the controls again, for the game and rules as they are. */
  rebuild(): void;
  /** Shows the room's game and rules, locked, for as long as the room is shown; the guest's own come back with `leaveRoom`. */
  follow(room: RoomInfo): void;
  leaveRoom(): void;
  /** The page with all the rules is open. */
  dialogOpen(): boolean;
  closeDialog(): void;
  /** Sends what was changed last, if it is still waiting to go, and takes the page down. */
  dispose(): void;
}

/**
 * The briefing of an online game: the preset cards, the quick controls and the page with all the rules. The host sets the
 * game up here, and everybody else sees the same page locked, following the host.
 */
export function createBriefing({ app, session, prefs, save }: BriefingContext): Briefing {
  const sound = app.menu.sound;
  const createPresetCards = h('div.items.items--row.briefing__cards', { role: 'group', 'aria-label': t('preset.choose') });
  /** The card chosen in the room's briefing, for as long as the lobby is open. */
  const presetState: { current?: PresetSelection } = {};
  const createQuick = h('div.briefing__quick', null);
  const createRules = h('div', null);
  /** All the rules on one page over this one: a link below the presets opens them, as it does in the local briefing. */
  const rulesLinkLabel = h('span.item__label', null, t('briefing.editRules'));
  const rulesLink = h('button.item.briefing__switch-action', { type: 'button' }, rulesLinkLabel);
  const rulesDone = h('button.item.item--primary', { type: 'button' }, t('briefing.done'));
  const rulesReset = h('button.item', { type: 'button' }, t('setup.reset'));
  const rulesCancel = h('button.item', { type: 'button', hidden: '' }, t('preset.creator.cancel'));
  const rulesDelete = h('button.item.item--delete', { type: 'button', hidden: '' }, t('preset.creator.delete'));
  /** Set while the page is the preset creator: the rules as they were when it opened, to go back to unless the preset is kept. */
  let creator: PresetCreator | null = null;
  const creatorName = h('div', { hidden: '' });
  /** The page of the local briefing — the same frame, the same groups, the same footer — over the lobby. */
  const rulesDialog = menuPage({
    title: t('briefing.editRules'), eyebrow: '', className: 'menu-page--rules',
    headerAside: creatorName, body: [createRules],
    keys: t('briefing.keys'),
    footer: h('div.items.items--row.menu-page__actions', null, rulesReset, rulesDelete, rulesCancel, rulesDone),
  });
  rulesDialog.classList.add('rules-page');
  rulesDialog.hidden = true;
  const closeRulesDialog = () => {
    creator = null;
    rulesDialog.hidden = true;
    rulesDialog.remove();
    rulesLink.focus({ preventScroll: true });
  };
  /** Where the focus goes once the creator is gone: the card it made, or else the plus. */
  const focusPresetCard = () => (createPresetCards.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? createPresetCards.querySelector<HTMLButtonElement>('.item--strip-empty, .item--custom-empty'))?.focus({ preventScroll: true });
  /** Closing the creator any way but Save puts the rules back. */
  const dismissRulesDialog = () => {
    const open = creator;
    open?.cancel();
    closeRulesDialog();
    if (open) focusPresetCard();
  };
  const openRulesDialog = (open: PresetCreator | null) => {
    creator = open;
    rulesDialog.querySelector('.eyebrow')!.textContent = modeName(prefs.gameMode, prefs.rules.mayhem > 0);
    rulesDialog.querySelector('.menu-page__title')!.textContent = open ? t(open.existing ? 'preset.creator.titleEdit' : 'preset.creator.title') : rulesLinkLabel.textContent;
    rulesDone.textContent = t(open ? 'preset.creator.save' : 'briefing.done');
    rulesCancel.hidden = !open;
    rulesDelete.hidden = !open?.existing;
    rulesDelete.textContent = t('preset.creator.delete');
    rulesDelete.classList.remove('is-confirming');
    creatorName.replaceChildren(...(open ? [presetNameField(open.name, open.defaultName, (name) => { open.name = name; })] : []));
    creatorName.hidden = !open;
    rulesReset.hidden = readOnly();
    rulesDialog.hidden = false;
    document.body.append(rulesDialog);
    rulesDone.focus();
  };
  rulesDone.addEventListener('click', () => {
    if (!creator) return closeRulesDialog();
    if (!creator.save()) return;
    // The cards are drawn again around the preset it made.
    closeRulesDialog();
    buildCreateRules();
    focusPresetCard();
  });
  rulesCancel.addEventListener('click', dismissRulesDialog);
  /** Deleting asks twice. */
  rulesDelete.addEventListener('click', () => {
    if (!creator?.existing) return;
    if (!creator.confirmDelete) {
      creator.confirmDelete = true;
      rulesDelete.textContent = t('preset.creator.deleteConfirm');
      rulesDelete.classList.add('is-confirming');
      return;
    }
    creator.remove();
    dismissRulesDialog();
    buildCreateRules();
    focusPresetCard();
  });
  rulesLink.addEventListener('click', () => openRulesDialog(null));
  let createRulesForm: RulesForm | null = null;
  let createQuickControls: Control[] = [];
  let paintCreatePresetState = () => {};
  /** Everybody but the host sees the game and its rules as the host set them, locked. */
  const readOnly = (): boolean => !!session.room && !session.you.host;
  /** What the host changes goes to the relay a moment later, as one message however many keys were pressed. */
  let rulesTimer: ReturnType<typeof setTimeout> | undefined;
  const pushRules = () => {
    clearTimeout(rulesTimer);
    rulesTimer = undefined;
    if (session.room && session.you.host) session.setRules(prefs.rules, prefs.gameMode);
  };
  /** The host's rules are remembered for the next room, and — inside a room — sent to everybody in it. */
  const commitRules = () => {
    save();
    if (!session.room) return;
    clearTimeout(rulesTimer);
    rulesTimer = setTimeout(pushRules, 250);
  };
  const createPowerups = powerUpSummary(() => prefs.rules, {
    canChange: () => !readOnly(),
    patch: (values) => {
      if (readOnly()) return;
      prefs.rules = { ...prefs.rules, ...values, powerUpKinds: [...values.powerUpKinds] };
      commitRules();
      createQuickControls.forEach((control) => control.refresh());
      createRulesForm?.refresh();
      paintCreatePresetState();
    },
  });
  /** Plays these rules from now on, and redraws everything that shows them. */
  const playRules = (rules: RoomRules) => {
    prefs.rules = rulesOf(rules);
    commitRules();
    createRulesForm?.refresh();
    createQuickControls.forEach((control) => control.refresh());
    paintCreatePresetState();
    createPowerups.update();
  };
  const presetCards = new PresetCards({
    mode: () => prefs.gameMode,
    online: true,
    rules: () => prefs.rules,
    apply: playRules,
    repaint: () => paintCreatePresetState(),
    rebuild: () => buildCreateRules(),
    showCreator: openRulesDialog,
    today: () => app.today(),
  }, presetState);
  const buildCreateRules = () => {
    if (readOnly() || !presetCards.selection()) presetCards.detect();
    createRulesForm = rulesForm(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: commitRules,
    }, app, readOnly(), () => {
      paintCreatePresetState();
      createPowerups.update();
      createQuickControls.forEach((control) => control.refresh());
    });
    createRules.replaceChildren(createRulesForm.el);
    const cards = presetCards.cards();
    const choices: { card: PresetCard; element: HTMLButtonElement; shell: HTMLDivElement; status: HTMLButtonElement; save: HTMLButtonElement; count: HTMLSpanElement }[] = [];
    const addCard = (card: PresetCard) => {
      // The player's own presets are slim strips; the first empty slot is a card of its own.
      const strip = card.kind === 'custom' || (card.kind === 'new' && !card.art);
      const shell = h('div.briefing__preset-shell', null) as HTMLDivElement;
      const status = h('button.item__status.item__status-reset', { type: 'button', hidden: '' },
        h('span.item__status-count', null),
        h('span.item__status-action', null, card.actionLabel()),
      ) as HTMLButtonElement;
      const save = h('button.item__status.item__status-save', { type: 'button', hidden: '', title: t('preset.custom.save') }, t('preset.custom.save')) as HTMLButtonElement;
      const count = status.querySelector<HTMLSpanElement>('.item__status-count')!;
      const element = (strip
        ? h('button.item.item--strip', { type: 'button', 'aria-pressed': 'false' }, h('span.item__title', null, card.label))
        : h('button.item.item--card.lobby__preset', { type: 'button', 'aria-pressed': 'false' },
            h('span.item__icon', { 'aria-hidden': 'true' }, ...(card.art ? [card.art()] : [])),
            h('span.item__title', null, card.label),
            ...(card.hint ? [h('span.item__hint', null, card.hint)] : []),
          )) as HTMLButtonElement;
      shell.append(element, status, ...(card.secondary ? [save] : []));
      if (card.kind === 'pick') {
        element.classList.add('item--pick');
        element.prepend(h('span.item__tag', null, t('preset.pick.today')));
      }
      if (card.kind === 'new') element.classList.add(card.art ? 'item--custom-empty' : 'item--strip-empty');
      element.classList.toggle('is-readonly', readOnly());
      status.addEventListener('click', (event) => {
        event.stopPropagation();
        if (status.hidden || readOnly()) return;
        card.action();
        sound.select();
        focusPresetCard();
      });
      save.addEventListener('click', (event) => {
        event.stopPropagation();
        if (save.hidden || readOnly()) return;
        card.secondary!.run();
        sound.select();
        focusPresetCard();
      });
      element.addEventListener('click', () => {
        if (readOnly()) return;
        if (card.open) {
          sound.select();
          return card.open();
        }
        card.choose();
        focusPresetCard();
        sound.select();
      });
      choices.push({ card, element, shell, status, save, count });
    };
    cards.forEach(addCard);
    const own = (card: PresetCard) => card.kind === 'custom' || card.kind === 'new';
    createPresetCards.replaceChildren(
      ...choices.filter(({ card }) => !own(card)).map(({ shell }) => shell),
      h('div.briefing__own', { 'data-own': String(cards.filter((card) => card.kind === 'custom').length) }, ...choices.filter(({ card }) => own(card)).map(({ shell }) => shell)),
    );
    paintCreatePresetState = () => {
      choices.forEach(({ card, element, shell, status, save, count }) => {
        const modified = card.modified();
        const text = card.status();
        const label = card.actionLabel();
        count.textContent = text;
        status.querySelector('.item__status-action')!.textContent = label;
        status.hidden = !text || readOnly();
        status.setAttribute('aria-label', text && label ? `${text}. ${label}` : text);
        status.title = label;
        save.hidden = !text || readOnly() || !(card.secondary?.visible() ?? false);
        element.classList.toggle('is-modified', modified);
        shell.classList.toggle('is-modified', modified);
        element.setAttribute('aria-pressed', String(card.selected()));
      });
    };
    paintCreatePresetState();
  };

  /** Back to the standard rules of the game being played, as the local rules page does. */
  rulesReset.addEventListener('click', () => {
    if (readOnly()) return;
    presetCards.resetToStandard();
    sound.select();
  });

  const buildCreateQuick = () => {
    // The strength of Mayhem comes last, in a row of its own under the sliders, while Mayhem is on.
    const quickKeys = ['rounds', 'shotTime', 'mayhem'];
    /** What a host wants to flip during a room, one click away instead of in the rules page. */
    const switchLabels: Partial<Record<keyof RoomRules, Key>> = { betting: 'room.betting', chatPlayersOnly: 'room.chatPlayersOnly' };
    const all = ruleItems(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: commitRules,
    }, true);
    const env = { sound, readonly: readOnly(), changed: () => {
      paintCreatePresetState();
      createPowerups.update();
      createRulesForm?.refresh();
    } };
    createQuickControls = all
      .filter(({ key }) => quickKeys.includes(key))
      .sort((a, b) => quickKeys.indexOf(a.key) - quickKeys.indexOf(b.key))
      .map(({ item }) => buildControl(item, env));
    const switches = all
      .filter(({ key }) => key in switchLabels)
      .map(({ key, item }) => buildControl({ ...item, label: t(switchLabels[key]!) }, env));
    createQuickControls.push(...switches);
    const sliders = createQuickControls.slice(0, createQuickControls.length - switches.length).map(({ el }) => el);
    const mayhem = sliders.pop()!;
    createQuick.replaceChildren(...sliders, h('div.briefing__mayhem', null, mayhem), createPowerups.el, h('div.briefing__switches', null, ...switches.map(({ el }) => el), rulesLink));
    createPowerups.update();
  };

  const createSetupMain = h('div.online-create__main', null,
    h('section.briefing__presets', null,
      createPresetCards,
      createQuick,
    ),
  );

  /** The host's own game and rules, kept aside while the room's are on show; they come back when the room is left. */
  let ownGame: { gameMode: GameMode; rules: RoomRules } | null = null;
  let followed = '';
  const rebuild = () => {
    buildCreateRules();
    buildCreateQuick();
  };

  return {
    el: createSetupMain,
    setRulesLabel: (text) => { rulesLinkLabel.textContent = text; },
    begin: () => {
      prefs.rules = presetCards.startRules();
      rebuild();
    },
    startGame: () => {
      presetCards.start();
      rebuild();
    },
    rebuild,
    follow: (room) => {
      ownGame ??= { gameMode: prefs.gameMode, rules: prefs.rules };
      const sameGame = followed.startsWith(`${room.id}|${room.gameMode}|`);
      followed = `${room.id}|${room.gameMode}|${JSON.stringify(room.rules)}`;
      prefs.gameMode = room.gameMode;
      prefs.rules = { ...prefs.rules, ...room.rules, powerUpKinds: [...room.rules.powerUpKinds] };
      if (sameGame) {
        presetCards.detect();
        createRulesForm?.refresh();
        createQuickControls.forEach((control) => control.refresh());
        paintCreatePresetState();
        createPowerups.update();
      } else {
        rebuild();
      }
    },
    leaveRoom: () => {
      followed = '';
      if (!ownGame) return;
      prefs.gameMode = ownGame.gameMode;
      prefs.rules = ownGame.rules;
      ownGame = null;
      presetState.current = undefined;
      rebuild();
    },
    dialogOpen: () => !rulesDialog.hidden,
    closeDialog: dismissRulesDialog,
    dispose: () => {
      if (rulesTimer) pushRules();
      rulesDialog.remove();
    },
  };
}
