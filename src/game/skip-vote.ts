import { SKIP_VOTE_TIME, type SkipVote } from './match-types';

/** What the vote reads of, and asks of, the match it is held in. */
export interface SkipVoteDeps {
  clock(): number;
  /** The people at the table: they are the ones who vote. */
  voters(): number[];
  /** Whether a round is on that could be skipped right now. */
  canSkipRound(): boolean;
  /** Ends the round where it stands (what skipping does to the books is the match's). */
  skipRound(): void;
  /** Whether this match is played online, against the people of a room. */
  online(): boolean;
  isCpu(player: number): boolean;
  /** Says in a notice why the vote is over without the round skipped. */
  said(text: 'skip.declined' | 'skip.lapsed'): void;
}

/** The vote to skip the round that is open, if any. Online only: offline the player simply skips. */
export class SkipVoting {
  vote: SkipVote | null = null;

  constructor(private readonly deps: SkipVoteDeps) {}

  /** Yes votes it takes to skip: more than half of the people at the table. */
  get needed(): number {
    return Math.floor(this.deps.voters().length / 2) + 1;
  }

  /** No vote is open any more (a new round, a round that ended, a round skipped). */
  clear(): void {
    this.vote = null;
  }

  /** A vote that has run out of time lapses. */
  tick(): void {
    if (this.vote && this.deps.clock() >= this.vote.until) this.end('skip.lapsed');
  }

  /**
   * Offline the player skips on their own. Online only the host (seat 0) may ask, which opens a vote its own
   * yes starts off. Nobody scores in a skipped round.
   */
  request(player: number): void {
    if (!this.deps.canSkipRound()) return;
    if (!this.deps.online()) return this.deps.skipRound();
    if (player !== 0 || this.vote || this.deps.isCpu(player)) return;
    this.vote = { by: player, yes: [], no: [], until: this.deps.clock() + SKIP_VOTE_TIME };
    this.answer(player, true);
  }

  /** One person's answer to the open vote; it counts once. The round is skipped when enough have said yes, and the vote lapses when too many have said no. */
  answer(player: number, yes: boolean): void {
    const vote = this.vote;
    const voters = this.deps.voters();
    if (!vote || !this.deps.canSkipRound() || this.deps.clock() >= vote.until || !voters.includes(player) || vote.yes.includes(player) || vote.no.includes(player)) return;
    (yes ? vote.yes : vote.no).push(player);
    if (vote.yes.length >= this.needed) this.deps.skipRound();
    else if (vote.no.length > voters.length - this.needed) this.end('skip.declined');
  }

  /** How this person has answered the open vote, null while they have not (or when they have no say). */
  answerOf(player: number): 'yes' | 'no' | null {
    const vote = this.vote;
    return vote?.yes.includes(player) ? 'yes' : vote?.no.includes(player) ? 'no' : null;
  }

  /** Whether this person may still answer the open vote. */
  canAnswer(player: number | null): boolean {
    return player !== null && !!this.vote && this.deps.voters().includes(player) && !this.answerOf(player);
  }

  /** Somebody left the table or came back to it: the vote is counted again for the people at it now. One that already has enough of them carries at once. */
  tableChanged(): void {
    const vote = this.vote;
    if (!vote) return;
    const voters = this.deps.voters();
    vote.yes = vote.yes.filter((id) => voters.includes(id));
    vote.no = vote.no.filter((id) => voters.includes(id));
    if (!this.deps.canSkipRound()) return;
    if (vote.yes.length && vote.yes.length >= this.needed) this.deps.skipRound();
    else if (vote.no.length > voters.length - this.needed) this.end('skip.declined');
  }

  private end(text: 'skip.declined' | 'skip.lapsed'): void {
    this.vote = null;
    this.deps.said(text);
  }
}
