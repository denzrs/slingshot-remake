import type { MarkKind, Match } from './match';

/** A mark that is on the cards right now, and whose cards carry it. */
export interface VisibleMark {
  kind: MarkKind;
  /** The ships whose card has it, with what it says there: what a kill of them pays for it, or what any kill of yours does (on your own card). */
  on: { id: number; name: string; points: number; own: boolean }[];
}

/** The order the legend lists marks in: what is true for everybody first, then what only you see, then your own card. */
const ORDER: MarkKind[] = ['bounty', 'shutdown', 'comeback', 'revenge', 'domination', 'avenger', 'underdog', 'firstBlood', 'opener', 'chain'];

/** The marks on the cards of the person at this screen as they stand, grouped by kind, for the pause menu to explain. Empty while no marks show. */
export function visibleMarks(match: Match): VisibleMark[] {
  const viewer = match.markViewer;
  const byKind = new Map<MarkKind, VisibleMark>();
  match.cardMarks.forEach((marks, id) => {
    for (const mark of marks) {
      const entry = byKind.get(mark.kind) ?? { kind: mark.kind, on: [] };
      entry.on.push({ id, name: match.players[id].name, points: mark.points, own: id === viewer });
      byKind.set(mark.kind, entry);
    }
  });
  return ORDER.flatMap((kind) => byKind.get(kind) ?? []);
}
