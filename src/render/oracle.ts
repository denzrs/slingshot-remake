import { COLORS, FONTS, HORIZON, ORACLE } from '../config';
import type { Match } from '../game';
import { oracleAwards, oracleMultiplier, stakeOptions, TIP_HIDDEN, TIP_HIT, TIP_MISS, TIP_NOBODY, type OracleKind, type OracleQuestion, type OracleResult, type RoundResult } from '../game/oracle';
import { fmt, fmtInt, t } from '../i18n';
import { rgba } from './color';
import { fitText, setSpacing } from './text';

/** What the HUD hands over to draw with: the canvas, its scale, and the playing field's box in CSS pixels. */
export interface OracleFrame {
  ctx: CanvasRenderingContext2D;
  k: number;
  field: { x: number; y: number; w: number; h: number };
  time: number;
  shipPos: (i: number) => { x: number; y: number };
  /** Show the key caps in the choices. Off on touch screens, and once somebody has tapped a choice with the pointer. */
  keyHints: boolean;
}

/** A tip a pointer can make: the pick, whether it answers the round question rather than the shot, and — for a bet — the points staked on the round tip. */
export interface OracleTap {
  pick: number;
  round: boolean;
  stake?: number;
}

interface Hit extends OracleTap {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Chip {
  label: string;
  pick: number;
  round?: boolean;
  /** A stake on the round tip: the chip puts this many points on it. */
  stake?: number;
  key?: string;
  /** The player's colour, for a name. */
  color?: string;
}

type Segment = [text: string, color: string];

/**
 * What the card at the bottom shows right now: the open question(s), the verdict on the shot that just
 * fell, or — when the round is over — how the round's question was answered and who did well.
 */
type Mode = 'none' | 'question' | 'verdict' | 'round';

/** The card's rows, in HUD units (times the scale): the pieces it is made of, bigger on touch screens. */
function sizes(touch: boolean) {
  return {
    width: 760,
    pad: 6,
    head: 38,
    choice: touch ? 58 : 44,
    chip: touch ? 44 : 30,
    round: touch ? 54 : 38,
    roundChip: touch ? 42 : 26,
    /** The row of the bet on the round question, under the round's own. */
    stake: touch ? 52 : 36,
    verdict: 44,
    line: 32,
    cycle: 30,
    /** Distance from the field's bottom edge: the question sits low, the round's card above the "next round" hint. */
    gap: 16,
    gapOver: 42,
  };
}

/** The oracle is read at a glance, so it never gets smaller than this, however small the field is drawn. */
const MIN_SCALE = 0.9;
const scaleOf = (f: OracleFrame) => Math.max(f.k, MIN_SCALE);

/** Every phase in which a question can be on screen. */
const ASKING = new Set(['aiming', 'flying']);

/** Seconds each honour (and the standings) stays up on the round's card. */
const CYCLE_SECONDS = 2.4;

/** Splits a text with a `{name}` in it, so the name can be drawn in the player's colour. */
function aroundName(key: 'oracle.hitQ'): [string, string] {
  const [before, after = ''] = t(key, { name: '\u0001' }).split('\u0001');
  return [before, after];
}

/**
 * The oracle as the eliminated player sees it: one card at the bottom edge. It asks the question (keys,
 * or tap), lets the others' tips lie face down and turn over, replaces itself with the verdict, and at
 * the end of the round shows how the round's question was answered and who did well. Around it: a ring
 * around the ship that was tipped, and — for the living — the ghosts' mood over the shooter.
 */
export class OracleHud {
  /** Where the choices were drawn last frame, for taps. */
  private hits: Hit[] = [];
  /** Top edge of the card this frame, so a hint can stack above it. */
  private mode: Mode = 'none';
  /** The round's card is a single row: there is no room under the scorecard for two. */
  private compact = false;
  private card = { x: 0, y: 0, w: 0, h: 0 };
  /** The verdict on show and since when. A verdict that falls during the killcam waits for it to end. */
  private shown: { match: Match | null; id: number; since: number } = { match: null, id: 0, since: 0 };
  /** When the tips of a locked question began to turn over. */
  private revealed: { match: Match | null; id: number; since: number } = { match: null, id: 0, since: 0 };

  /** The tip under a pointer (CSS pixels on the canvas), if it is over a choice. */
  hit(x: number, y: number): OracleTap | null {
    const found = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return found ? { pick: found.pick, round: found.round, ...(found.stake ? { stake: found.stake } : {}) } : null;
  }

  /** Called once per frame before anything is drawn. */
  begin(): void {
    this.hits = [];
    this.mode = 'none';
  }

  /** Whether the card holds a question or a verdict: it has the bottom edge, so the usual hint steps aside. */
  get asking(): boolean {
    return this.mode === 'question' || this.mode === 'verdict';
  }

  // ————————————————————————————— What is on the card —————————————————————————————

  /** The verdict on the viewer's own tip while it is fresh, as long as it is on show. */
  private verdictFor(f: OracleFrame, match: Match): OracleResult | null {
    const r = match.betOracle.result;
    const viewer = match.bettor;
    if (!r || viewer === null || !match.ghost || match.clock - r.at > 20 || !r.tips.some((tip) => tip.player === viewer)) return null;
    if (this.shown.match !== match || this.shown.id !== r.id) this.shown = { match, id: r.id, since: f.time };
    return f.time - this.shown.since < ORACLE.RESULT_SECONDS ? r : null;
  }

  /**
   * Decides what the card shows this frame and where it sits. `ghost`: this screen belongs to an
   * eliminated player; the living only ever see the round's summary.
   */
  plan(f: OracleFrame, match: Match, touch: boolean, ghost: boolean): void {
    const z = sizes(touch);
    const k = scaleOf(f);
    const o = match.betOracle;
    const over = match.phase === 'roundOver';
    let height = 0;
    if (over) {
      const result = o.roundResult?.round === match.round ? o.roundResult : null;
      if (!result && !o.roundRanking().length) return;
      this.mode = 'round';
      // With the scorecard in the middle there is not always room for a second row.
      const full = (z.pad * 2 + z.verdict + z.cycle) * k;
      this.compact = f.field.y + f.field.h - z.gapOver * k - full < f.field.y + f.field.h / 2 + 180 * f.k;
      height = z.pad * 2 + z.verdict + (this.compact ? 0 : z.cycle);
    } else if (ghost && ASKING.has(match.phase)) {
      if (this.verdictFor(f, match)) {
        this.mode = 'verdict';
        height = z.pad * 2 + z.verdict + z.line;
      } else if (o.question || o.roundQuestion) {
        this.mode = 'question';
        height = z.pad * 2 + z.head + (o.question ? z.choice : 0) + (o.roundQuestion ? z.round : 0) + (this.betState(match).show ? z.stake : 0);
      }
    }
    if (this.mode === 'none') return;
    const { field } = f;
    const w = Math.min(field.w - 32 * k, z.width * k);
    const h = height * k;
    this.card = { x: field.x + (field.w - w) / 2, y: field.y + field.h - (over ? z.gapOver : z.gap) * k - h, w, h };
  }

  /** Draws the card `plan` has laid out. */
  drawCard(f: OracleFrame, match: Match, touch: boolean): void {
    if (this.mode === 'none') return;
    const { ctx } = f;
    ctx.save();
    if (this.mode === 'round') {
      // Comes in with the scorecard.
      ctx.globalAlpha = Math.min(1, Math.max(0, (match.phaseTime - 0.9) / 0.5));
      this.drawRoundCard(f, match, touch);
    } else if (this.mode === 'verdict') {
      const r = match.betOracle.result!;
      const age = f.time - this.shown.since;
      ctx.globalAlpha = Math.min(1, (ORACLE.RESULT_SECONDS - age) / 0.4);
      this.drawVerdict(f, match, r, this.card, touch);
    } else {
      this.drawQuestionCard(f, match, touch);
    }
    ctx.restore();
  }

  /** A verdict that falls during the killcam shows at the top, where the bottom edge belongs to the replay. */
  drawKillcamVerdict(f: OracleFrame, match: Match, touch: boolean): void {
    const r = match.betOracle.result;
    const viewer = match.bettor;
    if (!r || viewer === null || !match.ghost || match.clock - r.at > 20 || !r.tips.some((tip) => tip.player === viewer)) return;
    const z = sizes(touch);
    const k = scaleOf(f);
    const { field } = f;
    const w = Math.min(field.w - 32 * k, z.width * k);
    const h = (z.pad * 2 + z.verdict + z.line) * k;
    this.drawVerdict(f, match, r, { x: field.x + (field.w - w) / 2, y: field.y + Math.max(34 * k, field.h * 0.09) + 14 * k, w, h }, touch);
  }

  // ————————————————————————————— Shared pieces —————————————————————————————

  private plate(f: OracleFrame, c: { x: number; y: number; w: number; h: number }, accent: string): void {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.fillStyle = rgba(COLORS.plate, 0.92);
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = accent;
    ctx.fillRect(c.x, c.y, 3 * k, c.h);
  }

  private hairline(f: OracleFrame, x: number, y: number, w: number): void {
    f.ctx.fillStyle = rgba(COLORS.bone, 0.12);
    f.ctx.fillRect(x, y, w, 1);
  }

  /** The small caps label at the left of a row ("ORAKEL"); returns where the row's content can start. */
  private rowLabel(f: OracleFrame, text: string, x: number, mid: number, color: string): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = `700 ${11 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    const label = text.toUpperCase();
    ctx.fillText(label, x, mid + 0.5 * k);
    const end = x + ctx.measureText(label).width;
    setSpacing(ctx, 0);
    return end + 16 * k;
  }

  /** The player's own points, and the multiplier while a streak runs, flush right. Returns the width taken. */
  private drawScore(f: OracleFrame, match: Match, right: number, mid: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    const score = match.bettor === null ? undefined : match.betOracle.scores[match.bettor];
    if (!score) return 0;
    // What the next right tip is worth.
    const streak = score.streak >= 1 ? ` ×${fmt(oracleMultiplier(score.streak + 1), 1).replace(/[.,]0$/, '')}` : '';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${14 * k}px ${FONTS.mono}`;
    const bonus = streak ? ctx.measureText(streak).width : 0;
    if (streak) {
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(streak, right, mid + 0.5 * k);
    }
    ctx.fillStyle = COLORS.bone;
    const points = fmtInt(score.points);
    ctx.fillText(points, right - bonus, mid + 0.5 * k);
    return ctx.measureText(points).width + bonus;
  }

  private pickLabel(match: Match, kind: OracleKind, pick: number): string {
    if (kind === 'shot') return pick === TIP_HIT ? t('oracle.hit') : t('oracle.miss');
    return pick === TIP_NOBODY ? t('oracle.nobody') : match.players[pick]?.name ?? '';
  }

  /** What the crowd's bets have made of a side's odds, after its name ("Anna ×2.4") — in the stands' open book only. */
  private withOdds(match: Match, id: number, name: string): string {
    const o = match.betOracle;
    const odds = o.openBook ? o.oddsFor(id, (pick) => match.sideOf(pick)) : null;
    return odds ? `${name} ×${fmt(odds, 1)}` : name;
  }

  private roundPickLabel(match: Match, pick: number): string {
    return pick === TIP_NOBODY ? t('oracle.roundDraw') : match.players[pick]?.name ?? '';
  }

  /**
   * The choices as a row of chips, squeezed (names cut short) to fit the room. A chip is at least as
   * high as `h`; on a touch screen that is a comfortable target.
   */
  private drawChips(f: OracleFrame, chips: Chip[], selected: number | null, x: number, mid: number, room: number, h: number, px: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    const pad = 10 * k;
    const gap = 8 * k;
    const font = `700 ${px * k}px ${FONTS.body}`;
    const keyFont = `700 ${(px - 3) * k}px ${FONTS.mono}`;
    const keyWidth = (c: Chip) => (c.key && f.keyHints ? (c.key.length > 1 ? 22 : 16) * k : 0);
    const extras = (c: Chip) => pad * 2 + keyWidth(c);
    ctx.font = font;
    const natural = chips.map((c) => ctx.measureText(c.label).width + extras(c));
    const total = natural.reduce((s, n) => s + n, 0) + gap * (chips.length - 1);
    const squeeze = total > room ? (room - gap * (chips.length - 1) - chips.reduce((s, c) => s + extras(c), 0)) / chips.length : Infinity;

    let cx = x;
    chips.forEach((chip) => {
      ctx.font = font;
      const text = squeeze === Infinity ? chip.label : fitText(ctx, chip.label, Math.max(14 * k, squeeze));
      const w = ctx.measureText(text).width + extras(chip);
      const on = selected === chip.pick;
      const top = mid - (h * k) / 2;
      ctx.beginPath();
      ctx.roundRect(cx + 0.5, top + 0.5, w - 1, h * k - 1, 4 * k);
      if (on) {
        ctx.fillStyle = COLORS.sodium;
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(COLORS.bone, 0.06);
        ctx.fill();
        ctx.strokeStyle = rgba(COLORS.bone, 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      let tx = cx + pad;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (chip.key && f.keyHints) {
        ctx.font = keyFont;
        ctx.fillStyle = on ? COLORS.plate : COLORS.boneDim;
        ctx.fillText(chip.key, tx, mid + 0.5 * k);
        tx += keyWidth(chip);
      }
      ctx.font = font;
      ctx.fillStyle = on ? COLORS.plate : chip.color ?? COLORS.bone;
      ctx.fillText(text, tx, mid + 0.5 * k);
      this.hits.push({ x: cx, y: top, w, h: h * k, pick: chip.pick, round: !!chip.round, ...(chip.stake ? { stake: chip.stake } : {}) });
      cx += w + gap;
    });
    return cx - gap;
  }

  /** What was tipped, once the tips are in: a filled chip with the tip, or "no tip". Not tappable. */
  private drawTipChip(f: OracleFrame, text: string | null, x: number, mid: number, room: number, h: number, px: number): number {
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `700 ${px * k}px ${FONTS.body}`;
    const label = fitText(ctx, text ?? t('oracle.noTip'), Math.max(40 * k, room - 20 * k));
    const w = ctx.measureText(label).width + 20 * k;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, mid - (h * k) / 2 + 0.5, w - 1, h * k - 1, 4 * k);
    if (text === null) {
      ctx.strokeStyle = rgba(COLORS.bone, 0.25);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.boneDim;
    } else {
      ctx.fillStyle = COLORS.sodium;
      ctx.fill();
      ctx.fillStyle = COLORS.plate;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 10 * k, mid + 0.5 * k);
    return x + w;
  }

  /**
   * Tips as coloured pieces: "● Dora Daneben ✓". A face-down tip is "?". With `marks` each tip says
   * whether it was right. `names` off leaves just the colour dots, for when there is no room.
   */
  private tipSegments(match: Match, kind: OracleKind | 'round', tips: { player: number; pick: number; right?: boolean; fresh?: boolean }[], marks: boolean, names: boolean): Segment[] {
    const out: Segment[] = [];
    tips.forEach((tip, i) => {
      const who = match.tipster(tip.player) ?? { name: '?', color: COLORS.boneDim };
      const down = tip.pick === TIP_HIDDEN;
      const named = kind !== 'shot' && tip.pick >= 0 ? match.players[tip.pick] : undefined;
      if (i) out.push(['    ', COLORS.bone]);
      out.push(['● ', who.color]);
      if (names) out.push([`${who.name} `, COLORS.boneDim]);
      if (down) out.push([t('oracle.hidden'), COLORS.boneDim]);
      else out.push([kind === 'round' ? this.roundPickLabel(match, tip.pick) : this.pickLabel(match, kind, tip.pick), tip.fresh ? COLORS.sodium : named?.color ?? COLORS.bone]);
      if (marks) out.push(tip.right ? [' ✓', COLORS.sodium] : [' ✕', COLORS.boneDim]);
    });
    return out;
  }

  private segmentsWidth(ctx: CanvasRenderingContext2D, segments: Segment[]): number {
    return segments.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0);
  }

  private drawSegments(ctx: CanvasRenderingContext2D, segments: Segment[], x: number, y: number): void {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [text, color] of segments) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  }

  /**
   * Draws tips as pieces in the room there is: with names if they fit, else as dots, else the first few.
   * Left-aligned at `x` or, with `right`, flush to that edge.
   */
  private drawTips(f: OracleFrame, match: Match, kind: OracleKind | 'round', tips: { player: number; pick: number; right?: boolean; fresh?: boolean }[], marks: boolean, x: number, mid: number, room: number, right: boolean): void {
    if (!tips.length || room <= 0) return;
    const { ctx } = f;
    const k = scaleOf(f);
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    let shown = tips.length;
    let segments = this.tipSegments(match, kind, tips, marks, true);
    if (this.segmentsWidth(ctx, segments) > room) segments = this.tipSegments(match, kind, tips, marks, false);
    while (shown > 1 && this.segmentsWidth(ctx, segments) > room) segments = this.tipSegments(match, kind, tips.slice(0, --shown), marks, false);
    const width = this.segmentsWidth(ctx, segments);
    this.drawSegments(ctx, segments, right ? x - width : x, mid + 0.5 * k);
  }

  // ————————————————————————————— The question —————————————————————————————

  private drawQuestionCard(f: OracleFrame, match: Match, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const q = match.betOracle.question;
    const rq = match.betOracle.roundQuestion;
    const c = this.card;
    this.plate(f, c, COLORS.sodium);
    const left = c.x + 18 * k;
    const right = c.x + c.w - 16 * k;
    let y = c.y + z.pad * k;

    // The head: whose shot it is, and what a right tip would earn.
    const headMid = y + (z.head * k) / 2;
    const scoreW = this.drawScore(f, match, right, headMid);
    let cx = this.rowLabel(f, t('oracle.name'), left, headMid, COLORS.sodium);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    if (q?.kind === 'shot') {
      const shooter = match.players[q.shooter];
      const [before, after] = aroundName('oracle.hitQ');
      for (const [text, color] of [[before, COLORS.bone], [shooter.name, shooter.color], [after, COLORS.bone]] as const) {
        ctx.fillStyle = color;
        ctx.fillText(text, cx, headMid + 0.5 * k);
        cx += ctx.measureText(text).width;
      }
    } else {
      ctx.fillStyle = q ? COLORS.bone : COLORS.boneDim;
      ctx.font = `${q ? 700 : 400} ${(q ? 17 : 14) * k}px ${FONTS.body}`;
      ctx.fillText(fitText(ctx, q ? t('oracle.salvoQ') : t('oracle.idle'), Math.max(40 * k, right - scoreW - 16 * k - cx)), cx, headMid + 0.5 * k);
    }
    y += z.head * k;

    if (q) {
      const mid = y + (z.choice * k) / 2;
      this.drawChoices(f, match, q, left, right, mid, touch);
      y += z.choice * k;
    }

    if (rq) {
      if (q) this.hairline(f, left, y, right - left);
      this.drawRoundRow(f, match, left, right, y + (z.round * k) / 2, touch);
      y += z.round * k;
      const bet = this.betState(match);
      if (bet.show) {
        this.hairline(f, left, y, right - left);
        this.drawBetRow(f, match, bet, left, right, y + (z.stake * k) / 2, touch);
      }
    }

    if (q && !q.locked && q.kind === 'salvo' && match.shotClock !== null) {
      // The salvo's shared clock runs out, and so does the time to tip.
      ctx.fillStyle = COLORS.sodium;
      ctx.fillRect(c.x + 3 * k, c.y + c.h - 2 * k, (c.w - 3 * k) * Math.max(0, Math.min(1, match.shotClock / HORIZON.SIMULTANEOUS_CLOCK)), 2 * k);
    }
  }

  /** The choices for this shot or salvo — or, once the shots are away, your tip — with the others' tips beside them. */
  private drawChoices(f: OracleFrame, match: Match, q: OracleQuestion, left: number, right: number, mid: number, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const me = match.betOracle.mine;
    const mine = me && me.id === q.id ? me.pick : null;

    // The others' tips lie face down while the question is open and turn over, one after another, when it is locked.
    if (this.revealed.match !== match || this.revealed.id !== q.id) {
      if (q.locked) this.revealed = { match, id: q.id, since: f.time };
    }
    const turning = q.locked ? f.time - this.revealed.since : -1;
    const tips = [...match.betOracle.picks]
      .filter(([player]) => player !== match.bettor && match.tipster(player))
      .map(([player, pick], i) => {
        const age = turning - i * ORACLE.REVEAL_STEP;
        const up = age >= 0 && pick !== TIP_HIDDEN;
        return { player, pick: up ? pick : TIP_HIDDEN, fresh: up && age < 0.5 };
      });
    // The tips take the right-hand part of the row, in the room the choices leave them.
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    const dots = this.segmentsWidth(ctx, this.tipSegments(match, q.kind, tips, false, false));
    const tipsRoom = Math.max(dots, (right - left) * 0.42);

    if (!q.locked) {
      const chips = this.chipsFor(match, q, touch);
      const end = this.drawChips(f, chips, mine, left, mid, right - left - (tips.length ? tipsRoom + 16 * k : 0), z.chip, 14.5);
      if (tips.length) this.drawTips(f, match, q.kind, tips, false, right, mid, Math.min(tipsRoom, right - end - 16 * k), true);
      return;
    }
    const end = this.drawTipChip(f, mine === null ? null : `${t('oracle.mine', { pick: this.pickLabel(match, q.kind, mine) })}`, left, mid, right - left - tipsRoom, z.chip, 14.5);
    ctx.font = `400 ${13 * k}px ${FONTS.body}`;
    ctx.fillStyle = COLORS.boneDim;
    ctx.textAlign = 'left';
    const gap = 14 * k;
    const lockedRoom = right - end - gap - (tips.length ? tipsRoom + 16 * k : 0);
    if (lockedRoom > 80 * k) ctx.fillText(fitText(ctx, t('oracle.locked'), lockedRoom), end + gap, mid + 0.5 * k);
    if (tips.length) this.drawTips(f, match, q.kind, tips, false, right, mid, tipsRoom, true);
  }

  private chipsFor(match: Match, q: OracleQuestion, touch: boolean): Chip[] {
    if (q.kind === 'shot') {
      return [
        { label: touch ? t('oracle.hit') : `← ${t('oracle.hit')}`, pick: TIP_HIT },
        { label: touch ? t('oracle.miss') : `${t('oracle.miss')} →`, pick: TIP_MISS },
      ];
    }
    const ships = q.choices.map((id, i): Chip => ({ label: match.players[id].name, pick: id, color: match.players[id].color, key: String(i + 1) }));
    return [...ships, { label: t('oracle.nobody'), pick: TIP_NOBODY, key: '0' }];
  }

  /** "Who wins the round?" as a quieter row of its own at the bottom of the card. */
  private drawRoundRow(f: OracleFrame, match: Match, left: number, right: number, mid: number, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const rq = match.betOracle.roundQuestion!;
    let cx = this.rowLabel(f, t('oracle.roundName'), left, mid, rgba(COLORS.sodium, 0.75));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    const question = t('oracle.roundQ');
    ctx.fillText(question, cx, mid + 0.5 * k);
    cx += ctx.measureText(question).width + 16 * k;

    const me = match.betOracle.roundMine;
    const mine = me && me.id === rq.id ? me.pick : null;
    const aiming = match.phase === 'aiming';
    const chips: Chip[] = aiming
      ? match.roundChoices.map((id, i): Chip => ({ label: this.withOdds(match, id, match.players[id].name), pick: id, round: true, color: match.players[id].color, key: `⇧${i + 1}` }))
      : [];
    if (aiming && rq.draw) chips.push({ label: this.withOdds(match, TIP_NOBODY, t('oracle.roundDraw')), pick: TIP_NOBODY, round: true, key: '⇧0' });

    // How many have tipped goes at the right edge — if the choices keep their names without it.
    let edge = right;
    const tipped = match.betOracle.roundTippers.size;
    if (tipped) {
      ctx.font = `700 ${13 * k}px ${FONTS.body}`;
      const need = chips.reduce((sum, c) => sum + ctx.measureText(c.label).width + 28 * k + (f.keyHints ? 22 * k : 0), 0);
      ctx.font = `400 ${13 * k}px ${FONTS.body}`;
      const text = t('oracle.tipped', { n: tipped });
      const width = ctx.measureText(text).width + 16 * k;
      if (!chips.length || cx + need + width <= right) {
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.boneDim;
        ctx.fillText(text, right, mid + 0.5 * k);
        ctx.textAlign = 'left';
        edge -= width;
      }
    }
    if (!aiming) {
      // The shots are on their way: the tip stays as it is until the next aiming.
      this.drawTipChip(f, mine === null ? null : this.roundPickLabel(match, mine), cx, mid, edge - cx, z.roundChip, 13);
      return;
    }
    this.drawChips(f, chips, mine, cx, mid, edge - cx, z.roundChip, 13);
  }

  /** What the bet on the round question looks like for this screen: the stakes there are to choose from, what is staked, the pot. */
  private betState(match: Match): { show: boolean; options: number[]; staked: number; pot: number; tipped: boolean } {
    const o = match.betOracle;
    const viewer = match.bettor;
    const none = { show: false, options: [], staked: 0, pot: o.pot, tipped: false };
    if (viewer === null || !match.ghost || !o.roundQuestion || !match.bettingOn) return none;
    const staked = o.stakeOf(viewer);
    const me = o.roundMine;
    const tipped = !!me && me.id === o.roundQuestion.id;
    const options = !staked && match.canBetRound(viewer) ? stakeOptions(match.purse(viewer)) : [];
    return { show: options.length > 0 || staked > 0 || o.pot > 0, options, staked, pot: o.pot, tipped };
  }

  /**
   * The bet on the round question: points of the match staked on the tip, once. A tip first, then the stake
   * — a share of the score, half of it or all — and the pot of everybody's stakes beside it.
   */
  private drawBetRow(f: OracleFrame, match: Match, bet: { options: number[]; staked: number; pot: number; tipped: boolean }, left: number, right: number, mid: number, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const cx = this.rowLabel(f, t('oracle.stake'), left, mid, rgba(COLORS.sodium, 0.75));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // The pot at the right edge.
    let edge = right;
    if (bet.pot > 0) {
      ctx.font = `700 ${13 * k}px ${FONTS.body}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.sodium;
      const text = t('oracle.pot', { n: fmtInt(bet.pot) });
      ctx.fillText(text, right, mid + 0.5 * k);
      edge -= ctx.measureText(text).width + 16 * k;
      ctx.textAlign = 'left';
    }

    if (bet.staked) {
      this.drawTipChip(f, t('oracle.stakeMine', { n: fmtInt(bet.staked) }), cx, mid, edge - cx, z.roundChip, 13);
      return;
    }
    if (!bet.tipped) {
      ctx.font = `400 ${13 * k}px ${FONTS.body}`;
      ctx.fillStyle = COLORS.boneDim;
      ctx.fillText(fitText(ctx, t('oracle.betFirst'), Math.max(40 * k, edge - cx)), cx, mid + 0.5 * k);
      return;
    }
    const pick = match.betOracle.roundMine!.pick;
    const keys = bet.options.length === 2 ? ['B', '⇧B'] : ['⇧B'];
    const chips = bet.options.map((amount, i): Chip => ({ label: fmtInt(amount), pick, round: true, stake: amount, key: keys[i] }));
    this.drawChips(f, chips, null, cx, mid, edge - cx, z.roundChip, 13);
  }

  // ————————————————————————————— The verdict —————————————————————————————

  /** "RIGHT +150 · against the crowd", and below it how the others' tips turned out. Replaces the question on the card. */
  private drawVerdict(f: OracleFrame, match: Match, r: OracleResult, c: { x: number; y: number; w: number; h: number }, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const viewer = match.bettor!;
    const mine = r.tips.find((tip) => tip.player === viewer)!;
    const accent = mine.right ? COLORS.sodium : COLORS.boneDim;
    this.plate(f, c, accent);
    const left = c.x + 18 * k;
    const right = c.x + c.w - 16 * k;
    const mid = c.y + z.pad * k + (z.verdict * k) / 2;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = left;
    const verdict = mine.right ? t('oracle.right') : t('oracle.wrong');
    ctx.font = `800 ${22 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    ctx.fillStyle = accent;
    ctx.fillText(verdict, cx, mid + 0.5 * k);
    cx += ctx.measureText(verdict).width + 14 * k;
    setSpacing(ctx, 0);
    if (mine.right) {
      ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
      ctx.fillStyle = COLORS.sodium;
      const points = `+${mine.points}`;
      ctx.fillText(points, cx, mid + 0.5 * k);
      cx += ctx.measureText(points).width + 14 * k;
    }
    ctx.font = `400 ${14.5 * k}px ${FONTS.body}`;
    ctx.fillStyle = COLORS.boneDim;
    const headline = fitText(ctx, this.headline(match, r), Math.max(60 * k, right - cx));
    ctx.fillText(headline, cx, mid + 0.5 * k);
    cx += ctx.measureText(headline).width;
    if (mine.underdog) {
      ctx.font = `700 ${14.5 * k}px ${FONTS.body}`;
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(`  ·  ${t('oracle.underdog')}`, cx, mid + 0.5 * k);
    }

    const others = r.tips.filter((tip) => tip.player !== viewer);
    if (others.length) {
      this.hairline(f, left, c.y + (z.pad + z.verdict) * k, right - left);
      this.drawTips(f, match, r.kind, others, true, left, c.y + (z.pad + z.verdict + z.line / 2) * k, right - left, false);
    }
  }

  /** What the shots did, in a few words. */
  private headline(match: Match, r: OracleResult): string {
    if (r.kind === 'shot') return `${match.players[r.shooter].name}: ${r.hit ? t('oracle.out.hit') : t('oracle.out.miss')}`;
    return r.victims.length ? t('oracle.out.victims', { names: r.victims.map((id) => match.players[id].name).join(', ') }) : t('oracle.out.nobody');
  }

  // ————————————————————————————— Round over —————————————————————————————

  /**
   * Who won the round and how the round's question was answered — everybody's tip turned over — and,
   * one at a time, the standings and the round's honours.
   */
  private drawRoundCard(f: OracleFrame, match: Match, touch: boolean): void {
    const { ctx } = f;
    const k = scaleOf(f);
    const z = sizes(touch);
    const o = match.betOracle;
    const c = this.card;
    const result = o.roundResult?.round === match.round ? o.roundResult : null;
    const viewer = match.bettor;
    const mine = result && viewer !== null && match.ghost ? result.tips.find((tip) => tip.player === viewer) : undefined;
    this.plate(f, c, mine && !mine.right ? COLORS.boneDim : COLORS.sodium);
    const left = c.x + 18 * k;
    const right = c.x + c.w - 16 * k;
    const y = c.y + z.pad * k;

    // Headline: who won the question, and — if you tipped — whether you were right.
    const mid = y + (z.verdict * k) / 2;
    let cx = this.rowLabel(f, t('oracle.name'), left, mid, COLORS.sodium);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let rightEdge = right;
    if (mine) {
      const verdict = mine.right ? `${t('oracle.right')}  +${mine.points}` : t('oracle.wrong');
      ctx.font = `800 ${20 * k}px ${FONTS.display}`;
      setSpacing(ctx, 1.5 * k);
      ctx.textAlign = 'right';
      ctx.fillStyle = mine.right ? COLORS.sodium : COLORS.boneDim;
      ctx.fillText(verdict, right, mid + 0.5 * k);
      rightEdge -= ctx.measureText(verdict).width + 16 * k;
      setSpacing(ctx, 0);
      ctx.textAlign = 'left';
    }
    const names = result?.winners.map((id) => match.players[id].name).join(', ') ?? '';
    const headline = !result ? t('oracle.roundStanding') : result.winners.length ? t('oracle.roundOut', { names }) : t('oracle.roundOutDraw');
    const items = this.cycleItems(match, result);

    if (this.compact) {
      // Little room under the scorecard: one row, the headline first and the rest following in turn.
      items.unshift([[[headline, COLORS.bone]]]);
      this.drawCycle(f, match, items, cx, rightEdge, mid, 16);
      return;
    }
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(fitText(ctx, headline, Math.max(60 * k, rightEdge - cx)), cx, mid + 0.5 * k);
    if (!items.length) return;
    const rowTop = y + z.verdict * k;
    this.hairline(f, left, rowTop, right - left);
    this.drawCycle(f, match, items, left, right, rowTop + (z.cycle * k) / 2, 13.5);
  }

  /** One of `items` at a time, each for a few seconds, with a dot per item at the right edge to say which. */
  private drawCycle(f: OracleFrame, match: Match, items: Segment[][][], left: number, right: number, mid: number, px: number): void {
    if (!items.length) return;
    const { ctx } = f;
    const k = scaleOf(f);
    const elapsed = Math.max(0, match.phaseTime - 1.2);
    const index = Math.floor(elapsed / CYCLE_SECONDS) % items.length;
    const local = elapsed - Math.floor(elapsed / CYCLE_SECONDS) * CYCLE_SECONDS;
    const dots = items.length > 1 ? items.length * 10 * k : 0;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, local / 0.25);
    ctx.font = `700 ${px * k}px ${FONTS.body}`;
    const room = right - left - dots - 12 * k;
    // The fullest version that fits; the last one is the shortest, cut off if it must be.
    let segments = items[index].find((variant) => this.segmentsWidth(ctx, variant) <= room) ?? items[index][items[index].length - 1];
    while (segments.length > 2 && this.segmentsWidth(ctx, segments) > room) segments = segments.slice(0, -1);
    this.drawSegments(ctx, segments, left, mid + 0.5 * k);
    ctx.restore();
    if (items.length > 1) {
      items.forEach((_, i) => {
        ctx.fillStyle = i === index ? COLORS.sodium : rgba(COLORS.bone, 0.25);
        ctx.beginPath();
        ctx.arc(right - dots + 5 * k + i * 10 * k, mid, 2.2 * k, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  /**
   * What the round's card shows one after the other: the answers to the round's question, the
   * standings, then every honour. Each is a few ways of writing the same line, fullest first.
   */
  private cycleItems(match: Match, result: RoundResult | null): Segment[][][] {
    const items: Segment[][][] = [];
    if (result?.tips.length) {
      const lead: Segment = [`${t('oracle.roundName')}   `, COLORS.sodium];
      items.push([true, false].map((names) => [lead, ...this.tipSegments(match, 'round', result.tips, true, names)]));
    }
    const bets = result?.tips.filter((tip) => tip.stake) ?? [];
    if (bets.length) {
      const pot = bets.reduce((sum, tip) => sum + tip.stake!, 0);
      const line = (names: boolean): Segment[] => {
        const out: Segment[] = [[`${t('oracle.bets')}   `, COLORS.sodium], [`${t('oracle.pot', { n: fmtInt(pot) })}    `, COLORS.boneDim]];
        bets.forEach((tip, i) => {
          const net = tip.payout! - tip.stake!;
          if (i) out.push(['    ', COLORS.bone]);
          const who = match.tipster(tip.player) ?? { name: '?', color: COLORS.boneDim };
          out.push(['● ', who.color]);
          if (names) out.push([`${who.name} `, COLORS.boneDim]);
          out.push([net > 0 ? `+${fmtInt(net)}` : net < 0 ? `−${fmtInt(-net)}` : '±0', net > 0 ? COLORS.sodium : net < 0 ? COLORS.boneDim : COLORS.bone]);
        });
        return out;
      };
      items.push([line(true), line(false)]);
    }
    const rows = match.betOracle.roundRanking();
    if (rows.length) {
      const line = (count: number): Segment[] => {
        const out: Segment[] = [[`${t('oracle.standing')}   `, COLORS.sodium]];
        rows.slice(0, count).forEach(({ player, score }, i) => {
          if (i) out.push(['    ', COLORS.bone]);
          const who = match.tipster(player) ?? { name: '?', color: COLORS.boneDim };
          out.push([who.name, who.color], [`  ${score.roundRight}/${score.roundTotal}  `, COLORS.bone], [`+${score.roundPoints}`, i === 0 ? COLORS.sodium : COLORS.boneDim]);
        });
        return out;
      };
      items.push([4, 3, 2, 1].map(line));
    }
    for (const award of oracleAwards(match.betOracle.scores, 'round')) {
      const who = match.tipster(award.player);
      if (who) items.push([[[`★ ${t(`oracle.award.${award.kind}`)}   `, COLORS.sodium], [who.name, who.color], [`   ${t(`oracle.awardValue.${award.kind}`, { n: award.value })}`, COLORS.boneDim]]]);
    }
    return items;
  }

  // ————————————————————————————— On the field —————————————————————————————

  /** A ring around whoever the question is about, and around the ship that was tipped. */
  drawMarks(f: OracleFrame, match: Match): void {
    const q = match.betOracle.question;
    if (!q || !ASKING.has(match.phase)) return;
    const { ctx, k } = f;
    const me = match.betOracle.mine;
    const mine = me && me.id === q.id ? me.pick : null;
    ctx.save();
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${11 * k}px ${FONTS.mono}`;
    const ring = (id: number, alpha: number, caption: string | null) => {
      const at = f.shipPos(id);
      ctx.strokeStyle = rgba(COLORS.sodium, alpha);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 22 * k, 0, Math.PI * 2);
      ctx.stroke();
      if (caption) {
        ctx.fillStyle = COLORS.sodium;
        // Ships up under the scoreboard get their caption below instead.
        ctx.fillText(caption, at.x, at.y - 30 * k < f.field.y + 130 * k ? at.y + 38 * k : at.y - 30 * k);
      }
    };
    if (q.kind === 'shot') ring(q.shooter, mine === null ? 0.55 : 0.9, mine === null ? null : this.pickLabel(match, q.kind, mine));
    else if (mine !== null && mine !== TIP_NOBODY) ring(mine, 0.9, t('oracle.yourTip'));
    ctx.restore();
  }

  /**
   * What the living feel: the ghosts' mood over the shooter's ship, once they have tipped. Not what each
   * of them tipped — and nothing the aim line does not already show.
   */
  drawMood(f: OracleFrame, match: Match): void {
    const q = match.betOracle.question;
    const mood = match.betOracle.mood;
    if (!q || q.kind !== 'shot' || !mood || match.ghost || match.bettor === null || !ASKING.has(match.phase)) return;
    const shooter = match.players[q.shooter];
    if (!shooter?.alive) return;
    const { ctx, field } = f;
    const k = scaleOf(f);
    const total = mood.hit + mood.miss;
    const hitSide = mood.hit > mood.miss;
    const you = match.bettor === q.shooter ? '.you' : '';
    const n = Math.max(mood.hit, mood.miss);
    const key = mood.hit === mood.miss ? `oracle.mood${you}.split` : `oracle.mood${you}.${hitSide ? 'hit' : 'miss'}`;
    const text = t(key as 'oracle.mood.split', { n, of: total });
    const at = f.shipPos(q.shooter);

    // A ring in the ghosts' colour — a shimmer that breathes with the doubt (or the faith).
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(f.time * 3);
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.strokeStyle = rgba(COLORS.sodium, 0.35 + 0.3 * pulse);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(at.x, at.y, (24 + 2 * pulse) * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.font = `700 ${13 * k}px ${FONTS.body}`;
    const w = Math.min(field.w - 32 * k, ctx.measureText(text).width + 30 * k);
    const h = 28 * k;
    const x = Math.min(field.x + field.w - 16 * k - w, Math.max(field.x + 16 * k, at.x - w / 2));
    // Ships up under the scoreboard get their pill below instead.
    const y = at.y - 34 * k - h < field.y + 130 * k ? at.y + 34 * k : at.y - 34 * k - h;
    ctx.fillStyle = rgba(COLORS.plate, 0.9);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x, y, 3 * k, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(fitText(ctx, text, w - 30 * k), x + 15 * k, y + h / 2 + 0.5 * k);
  }
}
