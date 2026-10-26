import { TEAMS } from '../../sim/config';
import { teamName } from '../../game';
import { t } from '../../platform/i18n';
import { h } from '../dom';
import './team-roster.css';

interface TeamSeat { team: number | null }

/** A team with more seats than this lays them out in two columns (three from five seats on): in a two-team game and in a three-team one. */
const MANY_SEATS = 3;
const MANY_SEATS_THREE = 2;

/** Keep occupied seats in their chosen team; spread the remaining slots over the smaller groups. */
export function groupRoster<T extends TeamSeat>(seats: readonly T[], teamCount: number): T[][] {
  if (teamCount < 2) return [[...seats]];
  const groups = Array.from({ length: teamCount }, () => [] as T[]);
  for (const seat of seats) if (seat.team !== null) groups[seat.team % teamCount].push(seat);
  for (const seat of seats) {
    if (seat.team !== null) continue;
    const smallest = Math.min(...groups.map((group) => group.length));
    groups.find((group) => group.length === smallest)!.push(seat);
  }
  return groups;
}

export interface RosterCard extends TeamSeat {
  key: string;
  label: string;
  el: HTMLElement;
  /** Only seats the local player is allowed to move provide this action. */
  move?: (team: number) => void;
}

/** Team columns are both the roster and the destination for dragging or tapping a move handle. */
export function teamRoster(label: string) {
  const columns = h('div.team-roster__columns', null);
  const hint = h('p.team-roster__hint', { role: 'status', 'aria-live': 'polite' });
  const el = h('div.team-roster', { 'aria-label': label }, columns, hint);
  let cards: RosterCard[] = [];
  let count = -1;
  let selected: string | null = null;
  let dragging: string | null = null;
  let grids: HTMLElement[] = [];
  let totals: HTMLElement[] = [];
  let destinations: HTMLButtonElement[] = [];
  let handles = new Map<string, HTMLButtonElement>();
  const assignments = new Map<string, number>();
  const selection = () => cards.find((card) => card.key === selected && card.move);

  const paintSelection = () => {
    const current = selection();
    for (const card of cards) {
      const on = card.key === current?.key;
      card.el.classList.toggle('is-moving', on);
      handles.get(card.key)?.setAttribute('aria-pressed', String(on));
    }
    destinations.forEach((button, team) => { button.hidden = !current || current.team === team; });
    hint.hidden = count < 2 || !cards.some((card) => card.move);
    hint.textContent = current ? t('players.moveTarget', { name: current.label }) : t('players.moveHint');
  };
  const cancel = () => {
    selected = null;
    dragging = null;
    columns.querySelectorAll('.is-drop-target').forEach((column) => column.classList.remove('is-drop-target'));
    paintSelection();
  };
  const moveTo = (team: number) => {
    const card = selection();
    if (!card?.move || card.team === team || team < 0 || team >= count) return;
    cancel();
    card.move(team);
    handles.get(card.key)?.focus({ preventScroll: true });
  };

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selected) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = handles.get(selected);
    cancel();
    handle?.focus();
  });

  const buildColumns = (teamCount: number) => {
    count = teamCount;
    selected = null;
    dragging = null;
    grids = [];
    totals = [];
    destinations = [];
    columns.replaceChildren();
    el.classList.toggle('has-teams', count > 1);
    el.dataset.teams = String(count);
    columns.style.setProperty('--team-count', String(Math.max(1, count)));
    for (let team = 0; team < Math.max(1, count); team++) {
      const grid = h('div.slot-grid.team-roster__grid', { role: 'group', 'aria-label': count > 1 ? teamName(team) : label });
      grids.push(grid);
      if (count < 2) { columns.append(grid); continue; }
      const total = h('span.team-column__count', null);
      totals.push(total);
      const destination = h('button.team-column__place', { type: 'button', hidden: '' }, t('players.moveHere', { team: teamName(team) })) as HTMLButtonElement;
      destination.addEventListener('click', () => moveTo(team));
      destinations.push(destination);
      const column = h('section.team-column', { 'aria-label': teamName(team) },
        h('div.team-column__head', null, h('h3', null, teamName(team)), total), destination, grid,
      );
      column.style.setProperty('--team-tone', TEAMS[team][0]);
      column.addEventListener('dragover', (event) => {
        if (!dragging || !selection() || selection()!.team === team) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        column.classList.add('is-drop-target');
      });
      column.addEventListener('dragleave', (event) => {
        if (!(event.relatedTarget instanceof Node) || !column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
      });
      column.addEventListener('drop', (event) => {
        if (!dragging) return;
        event.preventDefault();
        moveTo(team);
        cancel();
      });
      columns.append(column);
    }
  };

  return {
    el,
    teamOf(key: string): number | null { return assignments.get(key) ?? null; },
    show(next: RosterCard[], teamCount: number, capacity = next.length): void {
      if (selected && selection()?.label !== next.find((card) => card.key === selected)?.label) { selected = null; dragging = null; }
      cards = next;
      if (count !== teamCount) buildColumns(teamCount);
      if (!selection()) selected = null;
      const grouped = groupRoster(cards, count);
      // A team with many seats gets a wider column (its seats then sit two or, from five seats on, three across), so a lopsided split still fits the page.
      const many = count > 2 ? MANY_SEATS_THREE : MANY_SEATS;
      columns.style.setProperty('--team-cols', grouped.map((group) => `minmax(0, ${group.length > 4 ? 2.4 : group.length > many ? 1.7 : 1}fr)`).join(' '));
      assignments.clear();
      const nextHandles = new Map<string, HTMLButtonElement>();
      const focused = document.activeElement as HTMLElement | null;
      const hadFocus = !!focused && el.contains(focused);
      for (const [team, group] of grouped.entries()) {
        const grid = grids[team];
        grid.dataset.capacity = String(capacity);
        grid.classList.toggle('has-many', count > 1 && group.length > many);
        grid.classList.toggle('has-most', count > 1 && group.length > 4);
        if (totals[team]) totals[team].textContent = String(group.filter((card) => card.team !== null).length);
        for (const card of group) {
          assignments.set(card.key, team);
          card.el.classList.add('roster-entry');
          if (count > 1 && card.move) {
            const handle = handles.get(card.key) ?? h('button.roster-move', { type: 'button', draggable: 'true' }, '↔') as HTMLButtonElement;
            if (!handles.has(card.key)) {
              handle.addEventListener('click', (event) => {
                event.stopPropagation();
                selected = selected === card.key ? null : card.key;
                paintSelection();
              });
              handle.addEventListener('dragstart', (event) => {
                selected = card.key;
                dragging = card.key;
                if (event.dataTransfer) {
                  event.dataTransfer.setData('text/plain', card.key);
                  event.dataTransfer.effectAllowed = 'move';
                }
                paintSelection();
              });
              handle.addEventListener('dragend', cancel);
            }
            handle.setAttribute('aria-label', t('players.move', { name: card.label }));
            handle.title = t('players.move', { name: card.label });
            handle.dataset.slotFocus = `move-${card.key}`;
            nextHandles.set(card.key, handle);
            card.el.classList.add('has-move');
            if (handle.parentElement !== card.el) card.el.append(handle);
          } else {
            card.el.classList.remove('has-move');
            handles.get(card.key)?.remove();
          }
        }
        // Avoid moving stable nodes on ordinary settings refreshes: it would steal keyboard focus.
        const children = [...grid.children];
        if (children.length !== group.length || group.some((card, i) => children[i] !== card.el)) grid.replaceChildren(...group.map((card) => card.el));
      }
      handles = nextHandles;
      paintSelection();
      if (hadFocus && focused?.isConnected) focused.focus({ preventScroll: true });
    },
  };
}
