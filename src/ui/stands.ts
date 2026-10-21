import { GALLERY } from '../config';
import type { Match } from '../game';
import { galleryStakes, PICK_DRAW } from '../game/gallery';
import { fmt, fmtInt, t } from '../i18n';
import { h } from './dom';

/**
 * The stands, as a strip over the playfield. A spectator sees the book on the round — every side with the
 * odds the crowd has made and its share of the pot — and bets by tapping a side; everybody else only sees
 * how many are watching. Built from the match's gallery, so it follows the host's state like the rest of the screen.
 */
export class Stands {
  private shown = '';
  /** The stake the next tap puts on a side. */
  private stake: number = GALLERY.STAKES[0];

  constructor(
    private readonly panel: HTMLElement,
    private readonly badge: HTMLElement,
    private readonly bet: (pick: number, stake: number) => void,
  ) {}

  /** Call every frame. `spectatorId` is this screen's place in the stands, null for a player. */
  update(match: Match | null, spectatorId: number | null): void {
    const crowd = match?.gallery.seats.filter((seat) => seat.present).length ?? 0;
    this.badge.hidden = !match || spectatorId !== null || crowd === 0;
    if (!this.badge.hidden) {
      const text = t('stands.badge', { n: crowd });
      if (this.badge.textContent !== `👁 ${text}`) this.badge.textContent = `👁 ${text}`;
    }
    const seat = match && spectatorId !== null ? match.gallery.seats.find((s) => s.id === spectatorId) : undefined;
    // When the game is over the result screen takes over, with the final standings of the stands.
    this.panel.hidden = !match || !seat || match.phase === 'gameOver';
    if (this.panel.hidden || !match || !seat) {
      this.shown = '';
      return;
    }
    const { gallery } = match;
    const mine = gallery.betOf(seat.id);
    const options = galleryStakes(seat.balance + (mine?.stake ?? 0));
    if (!options.includes(this.stake)) this.stake = options.includes(GALLERY.STAKES[0]) ? GALLERY.STAKES[0] : (options.at(-1) ?? GALLERY.STAKES[0]);
    // Rebuilt only when something it shows changes, so a tap is not lost to a redraw in between.
    const key = JSON.stringify([gallery.snapshot(), seat.id, this.stake, match.phase, match.players.map((p) => p.name)]);
    if (key === this.shown) return;
    this.shown = key;
    this.panel.replaceChildren(...this.build(match, seat.id, options));
  }

  private build(match: Match, id: number, options: number[]): HTMLElement[] {
    const { gallery } = match;
    const seat = gallery.seats.find((s) => s.id === id)!;
    const ranking = gallery.ranking();
    const book = gallery.book;
    const mine = gallery.betOf(id);
    const nameOf = (pick: number) => (pick === PICK_DRAW ? t('stands.draw') : (match.players[pick]?.name ?? '?'));

    /** A row of the card: a small caps label, then what the row says. */
    const row = (label: string, ...content: (Node | string)[]) => h('div.stands__row', null, h('span.stands__label', null, label), ...content);
    const head = row(
      t('stands.title'),
      h('strong.stands__q', null, !book ? t('stands.title') : book.open ? t('stands.question') : t('stands.closed', { n: fmtInt(gallery.pot) })),
      h('span.stands__score', null, fmtInt(seat.balance), h('small', null, ` ${t('stands.rank', { n: ranking.findIndex((s) => s.id === id) + 1, total: ranking.length })}`)),
    );

    const rows: HTMLElement[] = [head];
    const result = gallery.result;
    const settled = result && result.round === match.round && !book;
    if (settled) {
      const outcome = result.winners.length ? t('stands.won', { name: result.winners.map(nameOf).join(' + ') }) : t('stands.drawn');
      const payout = result.payouts.find((p) => p.id === id);
      const net = payout ? payout.payout - payout.stake : 0;
      const verdict = !payout ? '' : payout.payout === payout.stake ? t('stands.refund', { n: payout.stake }) : net > 0 ? t('stands.youWon', { n: net }) : t('stands.youLost', { n: payout.stake });
      rows.push(row(t('stands.bets'), h('strong.stands__q', null, outcome), verdict ? h(`span.stands__verdict.${net > 0 ? 'is-win' : 'is-loss'}`, null, verdict) : ''));
      return rows;
    }
    if (!book) return rows;

    const open = book.open;
    const sides: { pick: number; color: string }[] = [...book.choices.map((pick) => ({ pick, color: match.players[pick]?.color ?? '#fff' })), ...(book.draw ? [{ pick: PICK_DRAW, color: '#9aa6bd' }] : [])];
    rows.push(
      row(
        t('stands.bets'),
        ...sides.map(({ pick, color }) => {
          const odds = gallery.odds(pick);
          const chosen = mine?.pick === pick;
          const chip = h(
            `button.stands__chip${chosen ? '.is-on' : ''}`,
            { type: 'button', ...(open && options.length ? {} : { disabled: '' }) },
            h('span.stands__name', null, nameOf(pick)),
            h('span.stands__odds', null, odds ? t('stands.odds', { odds: fmt(odds, 1) }) : t('stands.noOdds')),
            h('span.stands__share', null, `${Math.round(gallery.share(pick) * 100)}%`),
          );
          chip.style.setProperty('--tone', color);
          chip.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.bet(pick, this.stake);
          });
          return chip;
        }),
        h('span.stands__pot', null, t('oracle.pot', { n: fmtInt(gallery.pot) })),
      ),
    );
    if (open) {
      rows.push(
        row(
          t('stands.stake'),
          ...options.map((stake) => {
            const pill = h(`button.stands__chip.stands__chip--stake${stake === this.stake ? '.is-on' : ''}`, { type: 'button' }, fmtInt(stake));
            pill.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              this.stake = stake;
              // A bet already placed moves with the stake.
              if (mine) this.bet(mine.pick, stake);
            });
            return pill;
          }),
          h('span.stands__note', null, mine ? t('stands.yourBet', { n: mine.stake, name: nameOf(mine.pick) }) : options.length ? t('stands.noBet') : t('stands.broke')),
        ),
      );
    } else {
      rows.push(row(t('stands.stake'), h('span.stands__note', null, mine ? t('stands.yourBet', { n: mine.stake, name: nameOf(mine.pick) }) : t('stands.wait'))));
    }
    return rows;
  }
}
