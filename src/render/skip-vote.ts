import { COLORS, FONTS } from '../sim/config';
import type { Match } from '../game';
import { SKIP_VOTE_TIME } from '../game/match';
import { t } from '../platform/i18n';
import { rgba } from './color';
import type { OracleFrame } from './oracle';
import { fitText, setSpacing } from './text';

/** An answer to the vote, as a pointer can give it. */
export type SkipAnswer = 'yes' | 'no';

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  answer: SkipAnswer;
}

/** One person at the table and how they have voted. */
interface Seat {
  name: string;
  color: string;
  answer: SkipAnswer | null;
}

/** The card's rows, in HUD units (times the scale), bigger on touch screens. */
function sizes(touch: boolean) {
  return { width: 600, pad: 6, head: 38, row: touch ? 54 : 42, chip: touch ? 44 : 30, top: 70 };
}

/** Like the oracle's card, the vote is read at a glance and never gets smaller than this. */
const MIN_SCALE = 0.9;

/**
 * The vote to skip the round, as a card of the oracle's kind under the round label: who asks, how many
 * have said yes, the answer (keys or tap) and — dots like the oracle's tips — how each seat has voted.
 */
export class SkipVoteHud {
  /** Where the answers were drawn last frame, for taps. */
  private hits: Hit[] = [];

  /** The answer under a pointer (CSS pixels on the canvas), if it is over one. */
  hit(x: number, y: number): SkipAnswer | null {
    return this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)?.answer ?? null;
  }

  /** Called once per frame before anything is drawn. */
  begin(): void {
    this.hits = [];
  }

  draw(f: OracleFrame, match: Match, touch: boolean): void {
    const vote = match.skipVote;
    if (!vote) return;
    const { ctx, field } = f;
    const k = Math.max(f.k, MIN_SCALE);
    const z = sizes(touch);
    const w = Math.min(field.w - 32 * k, z.width * k);
    const h = (z.pad * 2 + z.head + z.row) * k;
    const x = field.x + (field.w - w) / 2;
    const y = field.y + z.top * k;
    const left = x + 18 * k;
    const right = x + w - 16 * k;

    ctx.save();
    ctx.fillStyle = rgba(COLORS.plate, 0.92);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x, y, 3 * k, h);

    // The head: what is asked, and how many yes it takes.
    const headMid = y + (z.pad + z.head / 2) * k;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = `700 ${14 * k}px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.bone;
    const votes = t('skip.votes', { yes: vote.yes.length, needed: match.skipVotesNeeded });
    ctx.fillText(votes, right, headMid + 0.5 * k);
    const votesW = ctx.measureText(votes).width;

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.sodium;
    ctx.font = `700 ${11 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    const label = t('skip.name').toUpperCase();
    ctx.fillText(label, left, headMid + 0.5 * k);
    let cx = left + ctx.measureText(label).width + 16 * k;
    setSpacing(ctx, 0);
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    const asker = match.players[vote.by];
    const [before, after = ''] = t('skip.q', { name: '\u0001' }).split('\u0001');
    const room = right - votesW - 16 * k - cx;
    const full = ctx.measureText(before + (asker?.name ?? '') + after).width;
    if (full <= room) {
      for (const [text, color] of [[before, COLORS.bone], [asker?.name ?? '', asker?.color ?? COLORS.bone], [after, COLORS.bone]] as const) {
        ctx.fillStyle = color;
        ctx.fillText(text, cx, headMid + 0.5 * k);
        cx += ctx.measureText(text).width;
      }
    } else {
      ctx.fillStyle = COLORS.bone;
      ctx.fillText(fitText(ctx, t('skip.banner'), Math.max(40 * k, room)), cx, headMid + 0.5 * k);
    }

    // The answer, with how each seat has voted at the right.
    const rowTop = y + (z.pad + z.head) * k;
    ctx.fillStyle = rgba(COLORS.bone, 0.12);
    ctx.fillRect(left, rowTop, right - left, 1);
    const mid = rowTop + (z.row * k) / 2;
    const dots = this.seats(match);
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    const seatsW = Math.min(this.seatsWidth(ctx, dots), (right - left) * 0.42);
    const end = this.drawAnswer(f, match, left, mid, right - left - seatsW - 16 * k, z.chip, k);
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    this.drawSeats(ctx, dots, right, mid + 0.5 * k, seatsW);

    // What a skipped round costs, if the row has room for it.
    const noteRoom = right - seatsW - 16 * k - end - 14 * k;
    if (noteRoom > 80 * k) {
      ctx.font = `400 ${13 * k}px ${FONTS.body}`;
      ctx.fillStyle = COLORS.boneDim;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, t('skip.nobody'), noteRoom), end + 14 * k, mid + 0.5 * k);
    }

    // The time left to answer.
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x + 3 * k, y + h - 2 * k, (w - 3 * k) * Math.max(0, Math.min(1, (vote.until - match.clock) / SKIP_VOTE_TIME)), 2 * k);
    ctx.restore();
  }

  /** Yes and no to press while the viewer still has a say; else what they answered, or that the others are being waited for. Returns where it ends. */
  private drawAnswer(f: OracleFrame, match: Match, x: number, mid: number, room: number, h: number, k: number): number {
    const { ctx } = f;
    const me = match.viewer;
    const answer = me === null ? null : match.skipAnswer(me);
    const px = 14.5 * k;
    ctx.font = `700 ${px}px ${FONTS.body}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (!match.canAnswerSkip(me)) {
      // Not tappable: a filled chip with the vote, or a plain word that the others still have to answer.
      if (!answer) {
        ctx.font = `400 ${13 * k}px ${FONTS.body}`;
        ctx.fillStyle = COLORS.boneDim;
        const text = fitText(ctx, t('skip.waiting'), Math.max(40 * k, room));
        ctx.fillText(text, x, mid + 0.5 * k);
        return x + ctx.measureText(text).width;
      }
      const text = fitText(ctx, t('skip.mine', { answer: t(answer === 'yes' ? 'skip.answerYes' : 'skip.answerNo') }), Math.max(40 * k, room - 20 * k));
      const w = ctx.measureText(text).width + 20 * k;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, mid - (h * k) / 2 + 0.5, w - 1, h * k - 1, 4 * k);
      ctx.fillStyle = COLORS.sodium;
      ctx.fill();
      ctx.fillStyle = COLORS.plate;
      ctx.fillText(text, x + 10 * k, mid + 0.5 * k);
      return x + w;
    }
    const chips: { answer: SkipAnswer; key: string; label: string }[] = [
      { answer: 'yes', key: 'J', label: t('skip.answerYes') },
      { answer: 'no', key: 'N', label: t('skip.answerNo') },
    ];
    const pad = 10 * k;
    const keyW = f.keyHints ? 16 * k : 0;
    let cx = x;
    for (const chip of chips) {
      ctx.font = `700 ${px}px ${FONTS.body}`;
      const w = ctx.measureText(chip.label).width + pad * 2 + keyW;
      const top = mid - (h * k) / 2;
      ctx.beginPath();
      ctx.roundRect(cx + 0.5, top + 0.5, w - 1, h * k - 1, 4 * k);
      ctx.fillStyle = rgba(COLORS.bone, 0.06);
      ctx.fill();
      ctx.strokeStyle = rgba(COLORS.bone, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      let tx = cx + pad;
      if (f.keyHints) {
        ctx.font = `700 ${(14.5 - 3) * k}px ${FONTS.mono}`;
        ctx.fillStyle = COLORS.boneDim;
        ctx.fillText(chip.key, tx, mid + 0.5 * k);
        tx += keyW;
      }
      ctx.font = `700 ${px}px ${FONTS.body}`;
      ctx.fillStyle = COLORS.bone;
      ctx.fillText(chip.label, tx, mid + 0.5 * k);
      this.hits.push({ x: cx, y: top, w, h: h * k, answer: chip.answer });
      cx += w + 8 * k;
    }
    return cx - 8 * k;
  }

  /** How each person at the table has voted, in their colour: "● Anna ✓". */
  private seats(match: Match): Seat[] {
    return match.players.filter((p) => !p.cpu).map((p) => ({ name: p.name, color: p.color, answer: match.skipAnswer(p.id) }));
  }

  private pieces(seats: Seat[], names: boolean): [text: string, color: string][] {
    const out: [string, string][] = [];
    seats.forEach((s, i) => {
      if (i) out.push(['    ', COLORS.bone]);
      out.push(['● ', s.color]);
      if (names) out.push([`${s.name} `, COLORS.boneDim]);
      out.push(s.answer === 'yes' ? ['✓', COLORS.sodium] : s.answer === 'no' ? ['✕', COLORS.boneDim] : ['…', COLORS.boneDim]);
    });
    return out;
  }

  private width(ctx: CanvasRenderingContext2D, pieces: [string, string][]): number {
    return pieces.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0);
  }

  private seatsWidth(ctx: CanvasRenderingContext2D, seats: Seat[]): number {
    return this.width(ctx, this.pieces(seats, true));
  }

  /** The seats flush to `right`: with names if they fit, else as dots. */
  private drawSeats(ctx: CanvasRenderingContext2D, seats: Seat[], right: number, y: number, room: number): void {
    let pieces = this.pieces(seats, true);
    if (this.width(ctx, pieces) > room) pieces = this.pieces(seats, false);
    let x = right - this.width(ctx, pieces);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [text, color] of pieces) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  }
}
