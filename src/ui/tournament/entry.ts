import { relayText, t } from '../../platform/i18n';
import type { MultiplayerSession } from '../../net/multiplayer';
import type { TournamentTemplate } from '../../data/tournamentTemplates';
import type { Avatar } from '../../platform/avatars';
import { h } from '../menu/menu';
import { modeArt } from '../menu/mode-icons';
import { textInput } from '../lobby/widgets';
import { defaultStages } from './setup';
import { templateList } from './templates';
import type { confirmDialog } from './confirm';

/** Three ways in: a new tournament, one from a saved template, or one somebody else made. */
export type Section = 'create' | 'load' | 'join';
export const SECTIONS: readonly Section[] = ['create', 'load', 'join'];
export const SECTION_TITLE = { create: 'tournament.create', load: 'tournament.loadTitle', join: 'tournament.joinTitle' } as const;

/** The bracket grows with the teams that found themselves in it, up to what the relay allows. */
const MAX_TEAMS = 16;

type EntryOptions = {
  session: MultiplayerSession;
  /** The pilot's name and symbol, or null when the name is missing (the field then says so). */
  takeName: () => string | null;
  /** The pilot's symbol, which their seat shows in the tournament's teams. */
  avatar: () => Avatar;
  notify: (message: string) => void;
  confirm: ReturnType<typeof confirmDialog>;
};

/** The page before you are in a tournament: make one, make one from a template, or join one by its code. */
export function tournamentEntry({ session, takeName, avatar, notify, confirm }: EntryOptions) {
  let teamSize = 1;
  /** Opens the file picker of the templates list on show; the footer has the button. */
  let uploadTemplate: () => void = () => {};

  // Joining by code looks like joining a room by code: the code's symbol beside one plain field, the button in the footer.
  const code = textInput('', { maxLength: 16, autocomplete: 'off', spellcheck: false, placeholder: t('tournament.codePlaceholder') });
  code.setAttribute('aria-label', t('tournament.code'));
  const codeError = h('p.lobby__field-error.online-code__error', { role: 'alert' });
  codeError.hidden = true;
  /** A join by code waits for the relay: a refusal ("not found") goes under the code, as it does for a room. */
  let joinPending = false;
  const join = () => {
    if (!code.value.trim()) {
      codeError.textContent = t('tournament.codeRequired');
      codeError.hidden = false;
      code.focus();
      return;
    }
    const player = takeName();
    if (!player) return;
    joinPending = true;
    session.notice = null;
    session.joinTournament(code.value, player, avatar());
  };
  code.addEventListener('keydown', (event) => { if (event.key === 'Enter') join(); });
  code.addEventListener('input', () => { codeError.hidden = true; });
  const joinView = h('section.online-code', null,
    h('div.online-code__art', null, modeArt('code')),
    h('div.online-code__form', null, h('div.online-code__code', null, h('div.lobby__field', null, code), codeError)),
  );

  /** A tile with a small picture of ships against ships. */
  const tile = (label: string, sub: string, art: string, on: boolean, pick: () => void) => {
    const el = h(`button.t-tile${on ? '.is-on' : ''}`, { type: 'button', 'aria-pressed': String(on) },
      h('span.t-tile__art', { 'aria-hidden': 'true' }, art), h('strong', null, label), ...(sub ? [h('span', null, sub)] : []));
    el.addEventListener('click', () => {
      pick();
      // Only the choice moves; the card stays as it is.
      el.parentElement?.querySelectorAll('.t-tile').forEach((tileEl) => {
        tileEl.classList.toggle('is-on', tileEl === el);
        tileEl.setAttribute('aria-pressed', String(tileEl === el));
      });
    });
    return el;
  };

  const createFromTemplate = (template: TournamentTemplate) => {
    const player = takeName();
    if (!player) return;
    const stages = template.stages.map((stage) => ({
      gameMode: stage.gameMode,
      rules: { ...stage.rules, powerUpKinds: [...stage.rules.powerUpKinds], anomalies: [...stage.rules.anomalies] },
    }));
    session.createTournament({ name: player, avatar: avatar(), teamSize: template.teamSize, maxTeams: MAX_TEAMS, stages });
  };

  const view = (section: Section): HTMLElement => {
    if (section === 'join') return joinView;
    if (section === 'load') {
      const list = templateList({ use: createFromTemplate, notify, confirm });
      uploadTemplate = list.upload;
      return h('div.t-entry.t-entry--load', null,
        h('section.t-card.t-entry__create', null,
          h('p.t-label', null, t('tournament.templates')),
          list.el,
        ),
      );
    }
    return h('div.t-entry', null,
      h('section.t-card.t-entry__create', null,
        h('p.t-label', null, t('tournament.teamSize')),
        h('div.t-tiles', null, ...[1, 2, 3].map((n) => tile(t('tournament.versus', { n }), t(n === 1 ? 'tournament.sizeSolo' : 'tournament.sizeTeam', { n }), `${'▲'.repeat(n)} ${'▼'.repeat(n)}`, teamSize === n, () => (teamSize = n)))),
      ),
    );
  };

  /** The create page's button, which sits in the footer. */
  const create = () => {
    const player = takeName();
    if (player) session.createTournament({ name: player, avatar: avatar(), teamSize, maxTeams: MAX_TEAMS, stages: defaultStages() });
  };

  /** After an update: a join by code that the relay refused says why under the code. */
  const settleJoin = (joined: boolean) => {
    if (!joinPending || (!joined && !session.notice)) return;
    joinPending = false;
    if (!joined && session.notice) {
      codeError.textContent = relayText(session.notice);
      codeError.hidden = false;
    }
  };

  return { view, join, create, upload: () => uploadTemplate(), settleJoin };
}
