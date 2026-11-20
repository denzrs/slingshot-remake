import { t } from '../../platform/i18n';
import type { TournamentStage } from '../../net/net';
import { defaultRoomRules, rulesOf } from '../../data/roomRules';
import { GAME_MODES, type GameMode } from '../../sim/modes';
import { modeName } from '../menu/mode-name';
import { h } from '../menu/menu';
import { button } from '../lobby/widgets';
import { createBriefing, type Briefing } from '../lobby/briefing';
import { enablePagerNavigation, modePagerHeader, positionModeCarousel, type ModeTransition } from '../screens/mode-pager';
import type { App } from '../screens';
import { stageName, STAGES } from './setup';
import { stageCard } from './stage-summary';

export interface StageEditor {
  el: HTMLElement;
  isOpen(): boolean;
  /** Shows what `stage` plays: to change it when `editable`, locked to look at otherwise. */
  open(stage: number, current: TournamentStage, depth: number, editable: boolean): void;
  /** Closes what is on top: the anomalies' sheet, the rules page, then the dialog. */
  close(): void;
}

/**
 * What one level of the bracket plays, set up as an online room's game is, in a dialog: the modes in the pager every mode page has
 * (Q/E, arrows, a swipe), and under it the room's own briefing — the preset cards with their badges and the player's own presets,
 * the rounds, the shot clock, the power-ups, and the link to all the rules. Applied to the level, or to every level at once.
 * Everybody but the organizers, and everybody once the level is under way, sees it locked, as a guest sees a room's briefing.
 */
export function stageEditor(app: App, apply: (stages: number[], game: TournamentStage) => void): StageEditor {
  let stage = 0;
  let depth = 1;
  /** The game being set up; the briefing changes it in place. */
  let game: TournamentStage = { gameMode: 'classic', rules: defaultRoomRules() };
  /** The rounds the level played before: "endless" on the rules page falls back to them, as a match must end. */
  let roundsBefore = 3;
  let briefing: Briefing | null = null;
  let stopPager = (): void => {};
  let editable = true;

  const eyebrow = h('p.t-editor__eyebrow', null);
  const header = h('div.t-editor__pager', null);
  const body = h('div.t-editor__body', null);
  const close = button('×');
  close.classList.add('t-editor__close');
  close.setAttribute('aria-label', t('tournament.close'));
  const applyOne = button(t('tournament.applyStage'), true);
  const applyAll = button(t('tournament.applyAll'));
  const done = button(t('briefing.done'), true);
  const panel = h('section.t-editor.t-editor--briefing', { role: 'dialog', 'aria-modal': 'true' },
    h('header.t-editor__head', null, h('div.t-editor__heading', null, eyebrow, header), close),
    body,
    h('footer.t-editor__foot', null, applyAll, applyOne, done),
  );
  const el = h('div.t-editor-backdrop', { hidden: 'hidden' }, panel);

  /** The modes as on a mode's page: the chosen one large and first, the next two peeking in after it. */
  const paintPager = (transition?: ModeTransition) => {
    stopPager();
    const pager = modePagerHeader(game.gameMode, transition);
    const nav = pager.querySelector<HTMLElement>('.mode-pager')!;
    const index = GAME_MODES.indexOf(game.gameMode);
    // Locked, only the mode the level plays stands in the pager.
    nav.replaceChildren(...GAME_MODES.slice(0, editable ? GAME_MODES.length : 1).map((_, distance) => {
      const mode = GAME_MODES[(index + distance) % GAME_MODES.length];
      const place = distance === 0 ? 'active' : distance === 1 ? 'near' : 'far';
      const item = h(`button.item.mode-pager__item.mode-pager__item--${mode}.mode-pager__item--${place}${distance === 0 ? '.is-selected' : ''}`,
        { type: 'button', 'aria-pressed': String(distance === 0) }, modeName(mode));
      if (editable) item.addEventListener('click', () => switchMode(mode, 'next'));
      return item;
    }));
    header.replaceChildren(pager);
    // The same entrance as a mode's page: the heading and the cards slide in from the side the switch came from.
    panel.dataset.enter = transition ?? '';
    const stopCarousel = positionModeCarousel(header);
    if (!editable) {
      pager.querySelector('.mode-pager__keys')?.remove();
      stopPager = stopCarousel;
      return;
    }
    const stopNavigation = enablePagerNavigation(panel, (direction) => {
      if (el.hidden || briefing?.dialogOpen()) return;
      const next = GAME_MODES[(GAME_MODES.indexOf(game.gameMode) + (direction === 'next' ? 1 : -1) + GAME_MODES.length) % GAME_MODES.length];
      switchMode(next, direction);
    }, '.briefing__cards, .preset-carousel__nav, .briefing__quick');
    stopPager = () => { stopNavigation(); stopCarousel(); };
  };

  const switchMode = (mode: GameMode, transition: ModeTransition) => {
    if (mode === game.gameMode) return;
    app.menu.sound.select();
    game.gameMode = mode;
    briefing!.startGame();
    paintPager(transition);
  };

  const build = (current: TournamentStage) => {
    briefing?.dispose();
    game = { gameMode: current.gameMode, rules: rulesOf(current.rules) };
    roundsBefore = current.rules.rounds || 3;
    briefing = createBriefing({ app, prefs: game, save: () => {}, finiteRounds: true, selection: stageCard(current, app.today()), readonly: !editable });
    briefing.setRulesLabel(t(editable ? 'briefing.editRules' : 'briefing.rules'));
    briefing.rebuild();
    body.replaceChildren(briefing.el);
    eyebrow.textContent = stageName(stage, depth);
    paintPager();
  };

  const hide = () => {
    el.hidden = true;
    stopPager();
    stopPager = () => {};
  };
  close.addEventListener('click', hide);
  done.addEventListener('click', hide);
  el.addEventListener('click', (event) => { if (event.target === el) hide(); });
  const result = (): TournamentStage => ({
    gameMode: game.gameMode,
    rules: { ...game.rules, rounds: game.rules.rounds || roundsBefore, powerUpKinds: [...game.rules.powerUpKinds] },
  });
  applyOne.addEventListener('click', () => { apply([stage], result()); hide(); });
  applyAll.addEventListener('click', () => { apply(Array.from({ length: STAGES }, (_, i) => i), result()); hide(); });

  return {
    el,
    isOpen: () => !el.hidden,
    open: (which, current, levels, canEdit) => {
      stage = which;
      depth = levels;
      editable = canEdit;
      applyOne.hidden = !editable;
      applyAll.hidden = !editable;
      done.hidden = editable;
      el.hidden = false;
      build(current);
      (editable ? applyOne : done).focus();
    },
    close: () => {
      if (briefing?.dialogOpen()) briefing.closeDialog();
      else hide();
    },
  };
}
