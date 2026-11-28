import { BETS, COLORS, FANS, FONTS } from '../sim/config';
import type { Match } from '../game';
import { betMultiplier, lossOf, oddsOf, PICK_DRAW, type Bet, type SettledBet, type StakeOption } from '../game/bets';
import { CALL_KINDS, type CallKind } from '../game/fans';
import { fmt, fmtInt, t } from '../platform/i18n';
import { rgba } from './color';
import { fitText, setSpacing } from './text';

/** What the HUD hands over to draw a card with: the canvas, its scale, and the playing field's box in CSS pixels. */
export interface CardFrame {
  ctx: CanvasRenderingContext2D;
  k: number;
  field: { x: number; y: number; w: number; h: number };
  time: number;
  shipPos: (i: number) => { x: number; y: number };
  /** Show the key caps in the choices. Off on touch screens, and once somebody has tapped a choice with the pointer. */
  keyHints: boolean;
}

/**
 * What a pointer (or a key) can do on the card: pick a side (`select`, which also roots for it), put a stake on the
 * side picked (`stake`), drop it (`cancel`), cheer on the ship you root for (`cheer`), or call its next shot (`call`).
 */
export interface BetTap {
  pick: number;
  stake?: number;
  select?: boolean;
  cancel?: boolean;
  cheer?: boolean;
  call?: CallKind;
}

/** The tap without where it was. */
const tapOf = ({ pick, stake, select, cancel, cheer, call }: BetTap): BetTap => ({
  pick,
  ...(stake ? { stake } : {}),
  ...(select ? { select } : {}),
  ...(cancel ? { cancel } : {}),
  ...(cheer ? { cheer } : {}),
  ...(call ? { call } : {}),
});

/** The keys that call the next shot: it hits (T), misses (D, daneben), or is hit (X). */
export const CALL_KEYS: Record<CallKind, string> = { hit: 'T', miss: 'D', hitBy: 'X' };

/** A multiplier as the card writes it: ×4, ×4,5, ×1,75. */
export const oddsLabel = (n: number): string => fmt(n, 2).replace(/[.,]?0+$/, '');

interface Hit extends BetTap {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Chip extends BetTap {
  label: string;
  key?: string;
  /** The player's colour, for a name. */
  color?: string;
  /** Chosen: drawn filled (the call made for the next shot). */
  on?: boolean;
}

type Segment = [text: string, color: string];

/** What the card at the bottom shows right now: the bet, a bet just settled, or — when the round is over — how the bets came out. */
type Mode = 'none' | 'bet' | 'verdict' | 'round';

/** The card's rows, in HUD units (times the scale), bigger on touch screens. */
function sizes(touch: boolean) {
  return {
    width: 760,
    pad: 6,
    bet: touch ? 54 : 42,
    chip: touch ? 42 : 28,
    verdict: 44,
    line: 32,
    /** Distance from the field's bottom edge: the bet sits low, the round's card above the "next round" hint. */
    gap: 16,
    gapOver: 42,
  };
}

/**
 * When this screen last cheered (the page's clock, in seconds). The host takes a cheer every `FANS.CHEER_GAP` seconds,
 * so none is sent sooner; the cheer chip flashes as it is pressed and then fills up in grey until it can be again.
 */
let cheeredAt = -Infinity;
/** How long the cheer chip flashes when pressed (s). */
const CHEER_FLASH = 0.3;

/** A cheer from this screen, now: whether it may go (the last one is `FANS.CHEER_GAP` seconds ago); if so, it is noted. */
export function tryCheer(now = performance.now() / 1000): boolean {
  if (now - cheeredAt < FANS.CHEER_GAP) return false;
  cheeredAt = now;
  return true;
}

/** The card is read at a glance, so it never gets smaller than this, however small the field is drawn. */
const MIN_SCALE = 0.9;
const scaleOf = (f: CardFrame) => Math.max(f.k, MIN_SCALE);

/** Every phase in which the bet can be on screen. */
const ASKING = new Set(['aiming', 'flying']);

/** The keys that put a quarter, half (H) or all (A) of the points on the side picked. */
const STAKE_KEYS: Record<number, string> = { 0.25: 'Q', 0.5: 'H', 1: 'A' };

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtInt(Math.abs(n))}`;

/** What the bet row looks like for this screen. */
type BetView =
  | { kind: 'hidden' }
  | { kind: 'open'; bet: Bet }
  | { kind: 'lost'; bet: SettledBet }
  | { kind: 'later' }
  | { kind: 'broke' }
  | { kind: 'choose' }
  | { kind: 'stake'; pick: number; options: StakeOption[] }
  /** No bet to make (the room plays none, or not now): root for a ship, or cheer on the one you root for. */
  | { kind: 'root' }
  | { kind: 'fan'; pick: number };

/**
 * The bet on the round as a shot-down player sees it: one card at the bottom edge. Pick a side (keys or tap), then
 * a share of your points on it; once placed, what it can come to. A settled bet takes the card's place for a
 * moment, and at the end of the round the card shows how everybody's bets came out. On the field, your escape pod
 * circles the ship you picked (`Renderer.drawPods`), and G cheers it on. Where there is no bet to make, the card
 * only asks who you root for.
 */
export class BetHud {
  /** Where the choices were drawn last frame, for taps. */
  private hits: Hit[] = [];
  private mode: Mode = 'none';
  private card = { x: 0, y: 0, w: 0, h: 0 };
  /** The settled bet on show and since when. One settled during the killcam waits for it to end. */
  private shown: { match: Match | null; id: number; since: number } = { match: null, id: 0, since: 0 };

  /** The choice under a pointer (CSS pixels on the canvas), if there is one. */
  hit(x: number, y: number): BetTap | null {
    const found = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return found ? tapOf(found) : null;
  }

  /** Called once per frame before anything is drawn. */
  begin(): void {
    this.hits = [];
    this.mode = 'none';
  }

  /** Whether the card holds the bet or a fresh verdict: it has the bottom edge, so the usual hint steps aside. */
  get asking(): boolean {
    return this.mode === 'bet' || this.mode === 'verdict';
  }

  /** The viewer's bet settled a moment ago, while it is on show. */
  private verdictFor(f: CardFrame, match: Match): SettledBet | null {
    const viewer = match.bettor;
    if (viewer === null || !match.ghost) return null;
    const bet = match.betBook.settled.find((b) => b.player === viewer && match.clock - b.at < 20);
    if (!bet) return null;
    if (this.shown.match !== match || this.shown.id !== bet.id) this.shown = { match, id: bet.id, since: f.time };
    return f.time - this.shown.since < BETS.RESULT_SECONDS ? bet : null;
  }

  /** What the bet row shows this frame. */
  private betView(match: Match): BetView {
    const book = match.betBook;
    const viewer = match.bettor;
    if (viewer === null || !(match.ghost || match.rooting)) return { kind: 'hidden' };
    // Without bets in the room the book stays empty, so this is only ever a bet of the room's.
    const mine = book.betOf(viewer);
    if (mine && 'won' in mine) return mine.won ? { kind: 'hidden' } : { kind: 'lost', bet: mine };
    if (mine) return { kind: 'open', bet: mine };
    if (match.ghost && book.question && match.canBet(viewer)) {
      const options = match.stakeChoices(viewer);
      const pending = book.pending && book.pending.id === book.question.id ? book.pending.pick : null;
      const stillIn = pending !== null && (pending === PICK_DRAW ? book.question.draw : match.roundChoices.includes(pending));
      if (options.length) return stillIn ? { kind: 'stake', pick: pending!, options } : { kind: 'choose' };
    }
    // No bet to make: the pod's own row, root for a ship and cheer it on.
    if (match.rooting) {
      const fan = match.fanBook.of(viewer);
      // A pod that went up with the side it rooted for is done for the round.
      if (fan) return match.podLost(viewer) || !match.fanChoices.length ? { kind: 'hidden' } : { kind: 'fan', pick: fan.pick };
      if (match.fanChoices.length > 1) return { kind: 'root' };
    }
    if (!match.ghost || !book.question) return { kind: 'hidden' };
    return match.canBet(viewer) ? { kind: 'broke' } : { kind: 'later' };
  }

  /** Decides what the card shows this frame and where it sits. `ghost`: this screen may bet; the living only see the round's summary. */
  plan(f: CardFrame, match: Match, touch: boolean, ghost: boolean): void {
    const z = sizes(touch);
    const k = scaleOf(f);
    let height = 0;
    if (match.phase === 'roundOver') {
      const result = match.betBook.result?.round === match.round ? match.betBook.result : null;
      if (!result?.bets.length) return;
      this.mode = 'round';
      height = z.pad * 2 + z.verdict + z.line;
    } else if (ghost && ASKING.has(match.phase)) {
      if (this.verdictFor(f, match)) {
        this.mode = 'verdict';
        height = z.pad * 2 + z.verdict;
      } else if (this.betView(match).kind !== 'hidden') {
        this.mode = 'bet';
        height = z.pad * 2 + z.bet;
      }
    }
    if (this.mode === 'none') return;
    const { field } = f;
    const w = Math.min(field.w - 32 * k, z.width * k);
    const h = height * k;
    const over = this.mode === 'round';
    this.card = { x: field.x + (field.w - w) / 2, y: field.y + field.h - (over ? z.gapOver : z.gap) * k - h, w, h };
  }

  /** Draws the card `plan` has laid out. */
  drawCard(f: CardFrame, match: Match, touch: boolean): void {
    if (this.mode === 'none') return;
    const { ctx } = f;
    ctx.save();
    if (this.mode === 'round') {
      // Comes in with the scorecard.
      ctx.globalAlpha = Math.min(1, Math.max(0, (match.phaseTime - 0.9) / 0.5));
      this.drawRoundCard(f, match, touch);
    } else if (this.mode === 'verdict') {
      const bet = this.verdictFor(f, match)!;
      ctx.globalAlpha = Math.min(1, (BETS.RESULT_SECONDS - (f.time - this.shown.since)) / 0.4);
      this.drawVerdict(f, match, bet, this.card, touch);
    } else {
      const c = this.card;
      this.plate(f, c, COLORS.sodium);
      this.drawBetRow(f, match, this.betView(match), c.x + 18 * scaleOf(f), c.x + c.w - 16 * scaleOf(f), c.y + c.h / 2, touch);
    }
    ctx.restore();
  }

  /** A bet settled during the killcam shows at the top, where the bottom edge belongs to the replay. */
  drawKillcamVerdict(f: CardFrame, match: Match, touch: boolean): void {
    const bet = this.verdictFor(f, match);
    if (!bet) return;
    const z = sizes(touch);
    const k = scaleOf(f);
    const { field } = f;
    const w = Math.min(field.w - 32 * k, z.width * k);
    this.drawVerdict(f, match, bet, { x: field.x + (field.w - w) / 2, y: field.y + Math.max(34 * k, field.h * 0.09) + 14 * k, w, h: (z.pad * 2 + z.verdict) * k }, touch);
  }

  // ————————————————————————————— Pieces —————————————————————————————

  private plate(f: CardFrame, c: { x: number; y: number; w: number; h: number }, accent: string): void {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.fillStyle = rgba(COLORS.plate, 0.92);
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = accent;
    ctx.fillRect(c.x, c.y, 3 * k, c.h);
  }

  private hairline(f: CardFrame, x: number, y: number, w: number): void {
    f.ctx.fillStyle = rgba(COLORS.bone, 0.12);
    f.ctx.fillRect(x, y, w, 1);
  }

  /** The small caps label at the left of a row ("WETTE"); returns where the row's content can start. Without `color` it is only measured. */
  private rowLabel(f: CardFrame, text: string, x: number, mid: number, color?: string): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 ${11 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    const label = text.toUpperCase();
    if (color) {
      ctx.fillStyle = color;
      ctx.fillText(label, x, mid + 0.5 * k);
    }
    const end = x + ctx.measureText(label).width;
    setSpacing(ctx, 0);
    return end + 16 * k;
  }

  /** Plain text in a row, cut to the room there is; returns where it ends. */
  private text(f: CardFrame, text: string, x: number, mid: number, room: number, color: string, weight = 400, px = 13.5): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `${weight} ${px * k}px ${FONTS.body}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const fitted = fitText(ctx, text, Math.max(30 * k, room));
    ctx.fillText(fitted, x, mid + 0.5 * k);
    return x + ctx.measureText(fitted).width;
  }

  /** How wide the chips are with nothing cut short. */
  private chipsWidth(f: CardFrame, chips: Chip[], px: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `700 ${px * k}px ${FONTS.body}`;
    const keyWidth = (c: Chip) => (c.key && f.keyHints ? (c.key.length > 1 ? 22 : 16) * k : 0);
    return chips.reduce((sum, c) => sum + ctx.measureText(c.label).width + 20 * k + keyWidth(c), 0) + 8 * k * (chips.length - 1);
  }

  /** The choices as a row of chips, squeezed (names cut short) to fit the room. On a touch screen a chip is a comfortable target. */
  private drawChips(f: CardFrame, chips: Chip[], x: number, mid: number, room: number, h: number, px: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    const pad = 10 * k;
    const gap = 8 * k;
    const font = `700 ${px * k}px ${FONTS.body}`;
    const keyFont = `700 ${(px - 3) * k}px ${FONTS.mono}`;
    const keyWidth = (c: Chip) => (c.key && f.keyHints ? (c.key.length > 1 ? 22 : 16) * k : 0);
    const extras = (c: Chip) => pad * 2 + keyWidth(c);
    ctx.font = font;
    const total = chips.reduce((s, c) => s + ctx.measureText(c.label).width + extras(c), 0) + gap * (chips.length - 1);
    const squeeze = total > room ? (room - gap * (chips.length - 1) - chips.reduce((s, c) => s + extras(c), 0)) / chips.length : Infinity;

    let cx = x;
    for (const chip of chips) {
      ctx.font = font;
      const text = squeeze === Infinity ? chip.label : fitText(ctx, chip.label, Math.max(14 * k, squeeze));
      const w = ctx.measureText(text).width + extras(chip);
      const top = mid - (h * k) / 2;
      ctx.beginPath();
      ctx.roundRect(cx + 0.5, top + 0.5, w - 1, h * k - 1, 4 * k);
      ctx.fillStyle = chip.on ? COLORS.sodium : rgba(COLORS.bone, 0.06);
      ctx.fill();
      // The cheer chip just pressed: it flashes, then fills up in grey from the left until it can be pressed again.
      const since = chip.cheer ? performance.now() / 1000 - cheeredAt : Infinity;
      const cooling = since < FANS.CHEER_GAP;
      if (cooling) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = rgba(COLORS.bone, 0.18);
        ctx.fillRect(cx, top, w * (since / FANS.CHEER_GAP), h * k);
        ctx.restore();
      }
      const flash = Math.max(0, 1 - since / CHEER_FLASH);
      if (flash > 0) {
        ctx.fillStyle = rgba(COLORS.sodium, 0.5 * flash);
        ctx.fill();
      }
      ctx.strokeStyle = chip.on || flash > 0 ? COLORS.sodium : rgba(COLORS.bone, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (cooling) ctx.globalAlpha = 0.5 + 0.5 * flash;
      let tx = cx + pad;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (chip.key && f.keyHints) {
        ctx.font = keyFont;
        ctx.fillStyle = chip.on ? rgba(COLORS.plate, 0.7) : COLORS.boneDim;
        ctx.fillText(chip.key, tx, mid + 0.5 * k);
        tx += keyWidth(chip);
      }
      ctx.font = font;
      ctx.fillStyle = chip.on ? COLORS.plate : chip.color ?? COLORS.bone;
      ctx.fillText(text, tx, mid + 0.5 * k);
      ctx.globalAlpha = 1;
      this.hits.push({ x: cx, y: top, w, h: h * k, ...tapOf(chip) });
      cx += w + gap;
    }
    return cx - gap;
  }

  /** A filled chip that says what is set: the side picked, or the bet placed. Not tappable. */
  private drawTag(f: CardFrame, text: string, x: number, mid: number, room: number, h: number, px: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `700 ${px * k}px ${FONTS.body}`;
    const label = fitText(ctx, text, Math.max(40 * k, room - 20 * k));
    const w = ctx.measureText(label).width + 20 * k;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, mid - (h * k) / 2 + 0.5, w - 1, h * k - 1, 4 * k);
    ctx.fillStyle = COLORS.sodium;
    ctx.fill();
    ctx.fillStyle = COLORS.plate;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 10 * k, mid + 0.5 * k);
    return x + w;
  }

  /** A side by name: a ship (its team in a team match), or the draw. */
  private sideLabel(match: Match, pick: number): string {
    return pick === PICK_DRAW ? t('bets.draw') : match.players[pick]?.name ?? '?';
  }

  /** Settled bets as coloured pieces: "● Dora +1.800". */
  private betSegments(match: Match, bets: readonly SettledBet[], names: boolean): Segment[] {
    const out: Segment[] = [];
    bets.forEach((bet, i) => {
      const who = match.tipster(bet.player) ?? { name: '?', color: COLORS.boneDim };
      if (i) out.push(['    ', COLORS.bone]);
      out.push(['● ', who.color]);
      if (names) out.push([`${who.name} `, COLORS.boneDim]);
      out.push([signed(bet.delta), bet.won ? COLORS.sodium : COLORS.boneDim]);
    });
    return out;
  }

  /** Draws the first way of writing the pieces that fits the room, else the last one, cut short. */
  private drawFitting(f: CardFrame, variants: Segment[][], x: number, mid: number, room: number): void {
    if (!variants.length || room <= 0) return;
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    const width = (segments: Segment[]) => segments.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0);
    let segments = variants.find((v) => width(v) <= room) ?? variants[variants.length - 1];
    while (segments.length > 2 && width(segments) > room) segments = segments.slice(0, -3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cx = x;
    for (const [text, color] of segments) {
      ctx.fillStyle = color;
      ctx.fillText(text, cx, mid + 0.5 * k);
      cx += ctx.measureText(text).width;
    }
  }

  // ————————————————————————————— The bet —————————————————————————————

  /** The bet, one row: the sides to choose from (and what a right bet pays), then the stakes; once placed, what it can come to. */
  private drawBetRow(f: CardFrame, match: Match, view: BetView, left: number, right: number, mid: number, touch: boolean): void {
    // A fan's row, with or without a bet: laid out on its own, as much of it as fits.
    if (view.kind === 'open') return this.drawFanRow(f, match, view.bet.pick, view.bet, left, right, mid, touch);
    if (view.kind === 'fan') return this.drawFanRow(f, match, view.pick, null, left, right, mid, touch);
    const k = scaleOf(f);
    const z = sizes(touch);
    const fanRow = view.kind === 'root';
    let label = t(fanRow ? 'fans.label' : 'bets.label');
    // Picking a side: a question and the names to answer it. Where the card is too narrow for both (a phone), the
    // names keep the room and the question goes; what it said about the odds moves into the label.
    const times = betMultiplier(0, match.sidesIn);
    let question = view.kind === 'choose' ? t('bets.question', { times }) : view.kind === 'root' ? t('fans.question') : null;
    const sides: Chip[] = [];
    if (view.kind === 'choose') {
      sides.push(...match.roundChoices.map((id, i) => ({ label: match.players[id].name, color: match.players[id].color, pick: id, select: true, key: String(i + 1) })));
      if (match.betBook.question?.draw) sides.push({ label: `${t('bets.draw')} ×${betMultiplier(PICK_DRAW, 0)}`, pick: PICK_DRAW, select: true, key: '0' });
    } else if (view.kind === 'root') {
      sides.push(...match.fanChoices.map((id, i) => ({ label: match.players[id].name, color: match.players[id].color, pick: id, select: true, key: String(i + 1) })));
    }
    if (question) {
      f.ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
      const wide = this.rowLabel(f, label, left, mid) + f.ctx.measureText(question).width + 14 * k + this.chipsWidth(f, sides, 13);
      if (wide > right) {
        question = null;
        if (view.kind === 'choose') label = `${label} ×${times}`;
      }
    }
    // The stakes: a share and its points, or only the points where that is too wide; on a phone the label steps aside too.
    let stakes: Chip[] = [];
    let showLabel = true;
    if (view.kind === 'stake') {
      const share = (x: number) => (x >= 1 ? t('bets.all') : `${Math.round(x * 100)} %`);
      const chipsOf = (short: boolean): Chip[] => [
        ...view.options.map((o) => ({ label: short ? fmtInt(o.amount) : `${share(o.share)} · ${fmtInt(o.amount)}`, pick: view.pick, stake: o.amount, key: STAKE_KEYS[o.share] })),
        { label: '✕', pick: view.pick, cancel: true },
      ];
      f.ctx.font = `700 ${13 * k}px ${FONTS.body}`;
      const tag = f.ctx.measureText(`${this.sideLabel(match, view.pick)} ×${betMultiplier(view.pick, match.sidesIn)}`).width + 20 * k + 12 * k;
      const after = this.rowLabel(f, label, left, mid) + tag;
      stakes = chipsOf(false);
      if (after + this.chipsWidth(f, stakes, 13) > right) stakes = chipsOf(true);
      if (after + this.chipsWidth(f, stakes, 13) > right) showLabel = false;
    }
    const cx = showLabel ? this.rowLabel(f, label, left, mid, COLORS.sodium) : left;
    const room = right - cx;
    const chipsFrom = question ? this.text(f, question, cx, mid, room * 0.32, COLORS.bone, 700) + 14 * k : cx;
    switch (view.kind) {
      case 'hidden':
        return;
      case 'root':
        this.drawChips(f, sides, chipsFrom, mid, right - chipsFrom, z.chip, 13);
        return;
      case 'lost':
        this.text(f, `${t('bets.lost')}  ${signed(view.bet.delta)}`, cx, mid, room, COLORS.boneDim, 700);
        return;
      case 'later':
        this.text(f, t('bets.later'), cx, mid, room, COLORS.boneDim);
        return;
      case 'broke':
        this.text(f, t('bets.broke'), cx, mid, room, COLORS.boneDim);
        return;
      case 'choose':
        this.drawChips(f, sides, chipsFrom, mid, right - chipsFrom, z.chip, 13);
        return;
      case 'stake': {
        const end = this.drawTag(f, `${this.sideLabel(match, view.pick)} ×${betMultiplier(view.pick, match.sidesIn)}`, cx, mid, room * 0.35, z.chip, 13);
        this.drawChips(f, stakes, end + 12 * k, mid, right - end - 12 * k, z.chip, 13);
        return;
      }
    }
  }

  /**
   * A fan's row: the ship they root for (and their bet on it, with the odds the calls made of it), what the bet can
   * come to, the calls on the next shot while it is aimed, and the cheer. Where the card is narrow (a phone), what
   * the bet can come to goes first, then the label, the stake and finally the cheer, so the calls always fit.
   */
  private drawFanRow(f: CardFrame, match: Match, pick: number, bet: Bet | null, left: number, right: number, mid: number, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const viewer = match.bettor;
    const fan = viewer === null ? undefined : match.fanBook.of(viewer);
    const name = this.sideLabel(match, pick);
    const odds = bet ? oddsOf(bet) : 0;
    const longTag = bet ? t('bets.mine', { stake: fmtInt(bet.stake), name, times: oddsLabel(odds) }) : name;
    const shortTag = bet ? `${name} ×${oddsLabel(odds)}` : name;
    const outcome = bet ? t('bets.odds', { win: fmtInt(Math.round(bet.stake * (odds - 1))), stake: fmtInt(lossOf(bet)) }) : null;
    // Without a bet a right call pays a few points: the buttons say how many, where there is room.
    const callable = viewer !== null && match.canCall(viewer);
    const callsOf = (points: boolean): Chip[] =>
      callable
        ? CALL_KINDS.map((kind) => ({
            label: points ? `${t(`fans.call.${kind}`)} +${FANS.CALL_POINTS[kind]}` : t(`fans.call.${kind}`),
            pick: -1,
            call: kind,
            key: CALL_KEYS[kind],
            on: fan?.call?.state === 'open' && fan.call.kind === kind,
          }))
        : [];
    const cheer: Chip[] = match.rooting && pick >= 0 ? [{ label: t('fans.cheer'), pick: -1, cheer: true, key: 'G' }] : [];
    const label = t(bet ? 'bets.label' : 'fans.label');
    const plain = [
      { label: true, tag: longTag, outcome: true, cheer: true, points: false },
      { label: true, tag: longTag, outcome: false, cheer: true, points: false },
      { label: true, tag: shortTag, outcome: false, cheer: true, points: false },
      { label: false, tag: shortTag, outcome: false, cheer: true, points: false },
      { label: false, tag: shortTag, outcome: false, cheer: false, points: false },
    ];
    const variants = bet ? plain : [...plain.slice(0, 4).map((v) => ({ ...v, points: true })), ...plain];
    const chipsOf = (v: (typeof variants)[number]) => (v.cheer ? [...callsOf(v.points), ...cheer] : callsOf(v.points));
    const widthOf = (v: (typeof variants)[number]): number => {
      let w = v.label ? this.rowLabel(f, label, left, mid) - left : 0;
      ctx.font = `700 ${13 * k}px ${FONTS.body}`;
      w += ctx.measureText(v.tag).width + 20 * k;
      if (v.outcome && outcome) {
        ctx.font = `400 ${13.5 * k}px ${FONTS.body}`;
        w += 14 * k + ctx.measureText(outcome).width;
      }
      const chips = chipsOf(v);
      return chips.length ? w + 12 * k + this.chipsWidth(f, chips, 13) : w;
    };
    const v = variants.find((each) => left + widthOf(each) <= right) ?? variants[variants.length - 1];
    let x = v.label ? this.rowLabel(f, label, left, mid, COLORS.sodium) : left;
    x = this.drawTag(f, v.tag, x, mid, right - x, z.chip, 13);
    if (v.outcome && outcome) x = this.text(f, outcome, x + 14 * k, mid, right - x - 14 * k, COLORS.boneDim);
    const chips = chipsOf(v);
    if (chips.length) this.drawChips(f, chips, x + 12 * k, mid, right - x - 12 * k, z.chip, 13);
  }

  /** "BET LOST −900 · Bob is out · place 2 → 3", or "BET WON +1.800 · place 3 → 1". */
  private drawVerdict(f: CardFrame, match: Match, bet: SettledBet, c: { x: number; y: number; w: number; h: number }, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const accent = bet.won ? COLORS.sodium : COLORS.boneDim;
    this.plate(f, c, accent);
    const left = c.x + 18 * k;
    const right = c.x + c.w - 16 * k;
    const mid = c.y + z.pad * k + (z.verdict * k) / 2;
    let cx = left;
    const head = bet.won ? t('bets.won') : t('bets.lost');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `800 ${22 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    ctx.fillStyle = accent;
    ctx.fillText(head, cx, mid + 0.5 * k);
    cx += ctx.measureText(head).width + 14 * k;
    setSpacing(ctx, 0);
    ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
    const points = signed(bet.delta);
    ctx.fillText(points, cx, mid + 0.5 * k);
    cx += ctx.measureText(points).width + 14 * k;
    const why = bet.won ? '' : t('bets.out', { name: this.sideLabel(match, bet.pick) });
    const place = bet.places && bet.places[0] !== bet.places[1] ? t('bets.place', { from: bet.places[0], to: bet.places[1] }) : '';
    this.text(f, [why, place].filter(Boolean).join('  ·  '), cx, mid, right - cx, COLORS.boneDim, 400, 14.5);
  }

  /** Who won the round and what the bets came to: yours big at the right, everybody's on the line below. */
  private drawRoundCard(f: CardFrame, match: Match, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const result = match.betBook.result!;
    const c = this.card;
    const viewer = match.bettor;
    const mine = viewer !== null ? result.bets.find((bet) => bet.player === viewer) : undefined;
    this.plate(f, c, mine && !mine.won ? COLORS.boneDim : COLORS.sodium);
    const left = c.x + 18 * k;
    const right = c.x + c.w - 16 * k;
    const y = c.y + z.pad * k;
    const mid = y + (z.verdict * k) / 2;
    const cx = this.rowLabel(f, t('bets.title'), left, mid, COLORS.sodium);

    let rightEdge = right;
    if (mine) {
      const place = mine.places && mine.places[0] !== mine.places[1] ? `  ${t('bets.place', { from: mine.places[0], to: mine.places[1] })}` : '';
      ctx.font = `400 ${13 * k}px ${FONTS.body}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.boneDim;
      if (place) {
        ctx.fillText(place, rightEdge, mid + 0.5 * k);
        rightEdge -= ctx.measureText(place).width + 6 * k;
      }
      const points = signed(mine.delta);
      ctx.font = `800 ${20 * k}px ${FONTS.display}`;
      ctx.fillStyle = mine.won ? COLORS.sodium : COLORS.boneDim;
      ctx.fillText(points, rightEdge, mid + 0.5 * k);
      rightEdge -= ctx.measureText(points).width + 16 * k;
      ctx.textAlign = 'left';
    }
    const names = result.winners.map((id) => match.players[id].name).join(', ');
    this.text(f, result.winners.length ? t('bets.roundWon', { names }) : t('bets.roundDraw'), cx, mid, rightEdge - cx, COLORS.bone, 700, 17);

    const rowTop = y + z.verdict * k;
    this.hairline(f, left, rowTop, right - left);
    const lineMid = rowTop + (z.line * k) / 2;
    this.drawFitting(f, [this.betSegments(match, result.bets, true), this.betSegments(match, result.bets, false)], left, lineMid, right - left);
  }
}
