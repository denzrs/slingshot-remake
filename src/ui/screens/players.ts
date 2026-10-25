import { COLORS, MAX_PLAYERS } from '../../config';
import { t, tn } from '../../i18n';
import { activeSeats, addSeat, balanceTeams, MIN_SEATS, removeSeat, type Seat } from '../../settings';
import { h, type MenuItem, type Screen } from '../menu';
import { menuGroup, menuPage } from '../menu-page';
import { teamRoster } from '../team-roster';
import type { App } from './app';

function playersScreen(app: App, lastCpuBySeat: Map<number, Seat>): Screen {
  const s = app.settings;
  const seats = activeSeats(s);
  const fliers = [
    { value: 'human', label: t('seat.human') },
    { value: 'easy', label: t('cpu.easy') },
    { value: 'medium', label: t('cpu.medium') },
    { value: 'hard', label: t('cpu.hard') },
    { value: 'hawking', label: t('cpu.hawking') },
  ];
  const board = teamRoster(t('briefing.crew'));
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => h('div.crew-slot', { 'data-section': `seat-${i}` }));

  const mode: MenuItem = {
    kind: 'segmented',
    section: 'mode',
    label: t('players.mode'),
    options: [
      { value: 0, label: t('players.ffa') },
      { value: 2, label: t('players.teams', { n: 2 }) },
      { value: 3, label: t('players.teams', { n: 3 }) },
    ],
    get: () => s.teamMode,
    set: (v) => {
      s.teamMode = v as number;
      if (s.teamMode) balanceTeams(s);
      app.settingsChanged();
      // The roster gains one column per team.
      app.menu.rebuild();
    },
  };
  const seat = (i: number): MenuItem => ({
    kind: 'seat',
    section: `seat-${i}`,
    label: t('players.player', { n: i + 1 }),
    swatch: COLORS.players[i],
    fliers,
    cpuCaption: t('players.cpu'),
    lastCpu: () => lastCpuBySeat.get(i),
    rememberCpu: (value) => lastCpuBySeat.set(i, value as Seat),
    get: () => s.seats[i],
    set: (v) => {
      s.seats[i] = v as Seat;
      app.settingsChanged();
    },
    remove: {
      label: t('players.remove', { n: i + 1 }),
      disabled: () => activeSeats(s).length <= MIN_SEATS,
      run: () => {
        if (!removeSeat(s, i)) return;
        app.settingsChanged();
        // The removed ship becomes an empty slot in the same position.
        app.menu.rebuild(1 + i);
      },
    },
  });

  const add = (i: number): MenuItem => ({
    kind: 'action', section: `seat-${i}`, className: 'slot-card slot-card--empty',
    tag: t('players.player', { n: i + 1 }),
    icon: () => h('span.slot-card__plus', { 'aria-hidden': 'true' }, '+'),
    hint: t('slots.free'), label: t('flow.addPilot'),
    choices: [
      { label: t('seat.human'), run: () => addAs(i, 'human') },
      { label: t('players.cpu'), run: () => addAs(i, 'cpu') },
    ],
    run: () => {
      addAs(i, 'human');
    },
  });
  const addAs = (i: number, flier: 'human' | 'cpu'): void => {
    const team = board.teamOf(String(i));
    const remembered = lastCpuBySeat.get(i);
    const cpu = remembered && remembered !== 'human' && remembered !== 'off' ? remembered : 'medium';
    if (addSeat(s, flier === 'human' ? 'human' : cpu, i) === null) return;
    if (flier !== 'human') lastCpuBySeat.set(i, cpu);
    if (s.teamMode && team !== null) s.seatTeams[i] = team;
    app.settingsChanged();
    app.menu.rebuild(1 + i);
  };

  const crewActions = h('div.items.items--row.crew-actions', { 'data-section': 'crew-actions' });
  const count = h('h3.setup__title', null, t('players.group.crew', { n: seats.length, max: MAX_PLAYERS }));
  const crewStatus = h('p.crew-roster__status', { 'aria-live': 'polite' });
  const roster = h('section.crew-roster', null,
    h('div.crew-roster__heading', null, count, h('div.crew-roster__aside', null, crewStatus, crewActions)),
    board.el,
  );
  const update = (): void => {
    const active = activeSeats(s);
    const humans = active.filter((i) => s.seats[i] === 'human').length;
    crewStatus.textContent = [
      ...(humans ? [`${humans} ${tn('lineup.human', humans)}`] : []),
      ...(active.length > humans ? [`${active.length - humans} ${tn('lineup.cpu', active.length - humans)}`] : []),
    ].join(' · ');
    board.show(slots.map((el, i) => ({
      key: String(i), el, label: t('players.player', { n: i + 1 }),
      team: s.seats[i] === 'off' ? null : s.seatTeams[i] % Math.max(1, s.teamMode),
      ...(s.seats[i] !== 'off' && s.teamMode ? { move: (team: number) => {
        s.seatTeams[i] = team;
        app.settingsChanged();
        app.menu.refresh();
      } } : {}),
    })), s.teamMode);
  };

  return {
    build: () => {
      board.show(slots.map((el, i) => ({ key: String(i), el, label: t('players.player', { n: i + 1 }), team: s.seats[i] === 'off' ? null : s.seatTeams[i] % Math.max(1, s.teamMode) })), s.teamMode);
      return menuPage({
        title: t('flow.crewTitle'), className: 'menu-page--crew',
        headerAside: h('div.crew-config', null, menuGroup(t('players.group.mode'), 'mode')),
        body: [roster],
        keys: t('flow.tabKeys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
    },
    items: [
      mode,
      ...Array.from({ length: MAX_PLAYERS }, (_, i) => s.seats[i] === 'off' ? add(i) : seat(i)),
      ...(s.teamMode
        ? [
            {
              kind: 'action',
              section: 'crew-actions',
              label: t('players.balance'),
              run: () => {
                balanceTeams(s);
                app.settingsChanged();
                app.menu.refresh();
              },
            } satisfies MenuItem,
          ]
        : []),
      { kind: 'action', section: 'actions', label: t('players.done'), primary: true, run: () => app.menu.back() },
    ],
    update,
  };
}

/** Keep each crew edit's remembered CPU choices across the screen's language/team rebuilds. */
export function openPlayers(app: App): void {
  const lastCpuBySeat = new Map<number, Seat>();
  app.menu.push(() => playersScreen(app, lastCpuBySeat));
}
