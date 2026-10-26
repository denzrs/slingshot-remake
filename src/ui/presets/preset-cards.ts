import type { GameMode } from '../../sim/modes';
import { clearOverride, deleteCustomPreset, loadCustomPresets, MAX_CUSTOM_PRESETS, saveCustomPreset, saveOverride, type CustomPreset } from '../../data/customPresets';
import { t } from '../../platform/i18n';
import { rulesOf, type RoomRules } from '../../data/roomRules';
import { presetArt, modeArt } from '../menu/mode-icons';
import {
  isOverridden, matchingCustom, matchingHandpicked, matchingPreset, pickOfTheDay, presetChangeCount, presetHintKey, presetRules, presetsForMode, resetRules, samePick, savedPresetRules,
  type MatchPreset,
} from './match-presets';
import { pickArt, pickHint, pickName } from './pick-of-day';

/** The rules a card was last chosen or kept with: what it goes back to, and what its edits are counted against. */
export interface PresetSelection {
  id: string;
  mode: GameMode;
  rules: RoomRules;
}

/** Where the cards are shown, local setup or online room: the rules they play on, and what to redraw when those change. */
export interface PresetHost {
  /** The game the cards are for. */
  mode(): GameMode;
  /** The rules are an online room's, which has the table's switches on top of the rules a card gives. */
  readonly online?: boolean;
  /** The rules as they play now. */
  rules(): RoomRules;
  /** Plays these rules from now on, and redraws whatever shows them. */
  apply(rules: RoomRules): void;
  /** The chosen card or its edits changed, but not the rules: redraw the cards. */
  repaint(): void;
  /** The player's own cards changed: build the cards again. */
  rebuild(): void;
  /** Shows the page for making or changing a preset of one's own. */
  showCreator(creator: PresetCreator): void;
  /** The day, for today's pick. */
  today(): string;
}

/** The preset creator's state. It lives outside the page, which is built again whenever a row changes. */
export interface PresetCreator {
  /** The rules as they were when it opened: Cancel, Esc and Delete put them back. */
  before: RoomRules;
  /** The preset being changed; none while a new one is made. */
  existing?: CustomPreset;
  name: string;
  defaultName: string;
  confirmDelete: boolean;
  saved: boolean;
  /** Keeps the preset; false when there is no room for it, or it is gone. */
  save(): boolean;
  /** Deletes the preset being changed. */
  remove(): void;
  /** Puts the rules back as they were, unless the preset was kept. */
  cancel(): void;
}

/** What a card shows and does, whichever page draws it. */
export interface PresetCard {
  id: string;
  /** A built-in preset, today's pick, one of the player's own, or the empty slot for the next one. */
  kind: 'preset' | 'pick' | 'custom' | 'new';
  label: string;
  /** The line under the name; empty for the player's own presets. */
  hint: string;
  /** The picture on the card, if it has one. */
  art?: () => SVGElement;
  selected(): boolean;
  /** The badge on the card: its edits come first, then what the card is. Empty hides it. */
  status(): string;
  /** Whether the rules have been changed from what the card gave. */
  modified(): boolean;
  actionLabel(): string;
  action(): void;
  /** A second action under the badge, while it holds: keeping the edits. */
  secondary?: { visible(): boolean; run(): void };
  /** Plays the card's rules. */
  choose(): void;
  /** The slot for the next preset opens the creator instead of choosing. */
  open?(): void;
}

const customId = (preset: CustomPreset): string => `custom:${preset.id}`;

/**
 * The preset cards of a setup page, with the rules behind them: which card is chosen, how far the rules have wandered from
 * it, how to go back or keep the changes, and the pages for making a preset of one's own. The local setup and the room
 * of an online game draw the same cards; only the drawing differs.
 */
export class PresetCards {
  constructor(
    private readonly host: PresetHost,
    /** Kept by the caller, so the choice survives the page being built again. */
    private readonly state: { current?: PresetSelection } = {},
  ) {}

  /** The chosen card, while it is one of this game's. */
  selection(): PresetSelection | undefined {
    const current = this.state.current;
    return current?.mode === this.host.mode() ? current : undefined;
  }

  private play(id: string, rules: RoomRules): void {
    this.state.current = { id, mode: this.host.mode(), rules: rulesOf(rules) };
    this.host.apply(rules);
  }

  /** Everything but a card's own rules stays: the table's switches are not part of a preset. */
  private withTable(rules: RoomRules): RoomRules {
    const { betting, chatPlayersOnly } = this.host.rules();
    return { ...rulesOf(rules), betting, chatPlayersOnly };
  }

  /** A new setup starts on the mode's first preset: chooses it, and gives its rules for the caller to put in place. */
  startRules(): RoomRules {
    const mode = this.host.mode();
    const first = presetsForMode(mode)[0];
    const rules = this.withTable(savedPresetRules(first, mode));
    this.state.current = { id: first, mode, rules: rulesOf(rules) };
    return rules;
  }

  /** Starts over on the mode's first preset, as a game mode change does. */
  start(): void {
    this.host.apply(this.startRules());
  }

  /** Takes the card that plays exactly the rules as they are, if there is one, as the chosen card. */
  detect(): void {
    const mode = this.host.mode();
    const rules = this.host.rules();
    const mine = matchingCustom(rules, mode);
    const id = matchingPreset(rules, mode)
      ?? (samePick(matchingHandpicked(rules, mode), pickOfTheDay(mode, this.host.today())) ? 'handpicked' : mine ? customId(mine) : undefined);
    this.state.current = id ? { id, mode, rules: rulesOf(rules) } : undefined;
  }

  /** How many rules differ from what the chosen card gave; none for the other cards. */
  changes(id: string): number {
    const selection = this.selection();
    return selection?.id === id ? presetChangeCount(this.host.rules(), selection.rules, selection.mode, this.host.online) : 0;
  }

  /** The badge text for edits: how many rules were changed. Empty when none were. */
  modifiedText(id: string): string {
    const changes = this.changes(id);
    return changes === 1 ? t('preset.modified.one') : changes > 1 ? t('preset.modified.many', { n: changes }) : '';
  }

  /** Back to what the card was when it was chosen, or last kept. */
  reset(id: string): void {
    const selection = this.selection();
    if (selection?.id !== id) return;
    this.host.apply(rulesOf(selection.rules));
  }

  /** The rules as they play now are what the card holds from here on. */
  keep(id: string): void {
    this.state.current = { id, mode: this.host.mode(), rules: rulesOf(this.host.rules()) };
    this.host.repaint();
  }

  /** The rules page's reset: the standard rules, or Mayhem at its strength; that card is the chosen one. */
  resetToStandard(): void {
    const { id, rules } = resetRules(this.host.rules(), this.host.mode());
    this.play(id, rules);
  }

  /** The cards in the order they are laid out: the presets, today's pick, the player's own, and the slot for the next one. */
  cards(): PresetCard[] {
    const mode = this.host.mode();
    return [...this.presetCards(mode), this.pickCard(mode), ...this.customCards(mode), ...this.newCard(mode)];
  }

  private presetCards(mode: GameMode): PresetCard[] {
    return presetsForMode(mode).map((preset: MatchPreset): PresetCard => ({
      id: preset,
      kind: 'preset',
      label: t(`preset.${preset}`),
      hint: t(presetHintKey(preset, mode)),
      art: () => presetArt(preset, mode),
      selected: () => this.selection()?.id === preset,
      // Edits come first; with none, a card the player changed and kept says so.
      status: () => this.modifiedText(preset) || (isOverridden(preset, mode) ? t('preset.overridden') : ''),
      modified: () => this.changes(preset) > 0,
      actionLabel: () => t(this.changes(preset) ? 'preset.resetAction' : 'preset.restoreOriginal'),
      action: () => {
        if (this.changes(preset)) return this.reset(preset);
        clearOverride(mode, preset);
        if (this.selection()?.id === preset) this.play(preset, this.withTable(presetRules(preset, mode)));
        else this.host.repaint();
      },
      secondary: {
        visible: () => this.changes(preset) > 0,
        run: () => {
          saveOverride(mode, preset, this.host.rules());
          this.keep(preset);
        },
      },
      choose: () => this.play(preset, this.withTable(savedPresetRules(preset, mode))),
    }));
  }

  private pickCard(mode: GameMode): PresetCard {
    const pick = pickOfTheDay(mode, this.host.today());
    return {
      id: 'handpicked',
      kind: 'pick',
      label: pickName(pick),
      hint: pickHint(pick),
      art: () => pickArt(pick),
      selected: () => this.selection()?.id === 'handpicked',
      status: () => this.modifiedText('handpicked'),
      modified: () => this.changes('handpicked') > 0,
      actionLabel: () => t('preset.resetAction'),
      action: () => this.reset('handpicked'),
      choose: () => this.play('handpicked', this.withTable(pick.rules)),
    };
  }

  private customCards(mode: GameMode): PresetCard[] {
    return loadCustomPresets(mode).map((preset): PresetCard => {
      const id = customId(preset);
      return {
        id,
        kind: 'custom',
        label: preset.name,
        hint: '',
        selected: () => this.selection()?.id === id,
        status: () => t(this.changes(id) ? 'preset.custom.modified' : 'preset.custom.edit'),
        modified: () => this.changes(id) > 0,
        actionLabel: () => t(this.changes(id) ? 'preset.resetAction' : 'preset.custom.edit'),
        action: () => (this.changes(id) ? this.reset(id) : this.openCreator(preset)),
        secondary: {
          visible: () => this.changes(id) > 0,
          run: () => {
            if (!saveCustomPreset(mode, { id: preset.id, name: preset.name, rules: this.host.rules() })) return;
            this.state.current = { id, mode, rules: rulesOf(this.host.rules()) };
            this.host.rebuild();
          },
        },
        choose: () => this.play(id, this.withTable(preset.rules)),
      };
    });
  }

  /** The slot for the next one: the first has a card to itself, from then on it is a strip below the others. */
  private newCard(mode: GameMode): PresetCard[] {
    const count = loadCustomPresets(mode).length;
    if (count >= MAX_CUSTOM_PRESETS) return [];
    return [{
      id: 'custom:new',
      kind: 'new',
      label: t('preset.custom.new'),
      hint: count === 0 ? t('preset.custom.empty') : '',
      ...(count === 0 ? { art: () => modeArt('customAdd') } : {}),
      selected: () => false,
      status: () => '',
      modified: () => false,
      actionLabel: () => '',
      action: () => {},
      choose: () => {},
      open: () => this.openCreator(),
    }];
  }

  /** One page for making a preset and for changing one: the rules page with a name above it. */
  openCreator(existing?: CustomPreset): void {
    const mode = this.host.mode();
    const before = rulesOf(this.host.rules());
    if (existing) this.host.apply(this.withTable(existing.rules));
    const creator: PresetCreator = {
      before,
      existing,
      name: existing?.name ?? '',
      defaultName: t('preset.creator.namePlaceholder', { n: loadCustomPresets(mode).length + 1 }),
      confirmDelete: false,
      saved: false,
      save: () => {
        const kept = saveCustomPreset(mode, { id: existing?.id, name: creator.name || creator.defaultName, rules: this.host.rules() });
        if (!kept) return false;
        this.state.current = { id: customId(kept), mode, rules: rulesOf(this.host.rules()) };
        creator.saved = true;
        return true;
      },
      remove: () => {
        if (existing) deleteCustomPreset(mode, existing.id);
      },
      cancel: () => {
        if (!creator.saved) this.host.apply(rulesOf(creator.before));
      },
    };
    this.host.showCreator(creator);
  }
}
