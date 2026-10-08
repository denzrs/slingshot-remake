import { COLORS, FONTS, HORIZON, ORACLE } from '../config';
import type { Match } from '../game';
import { oracleMultiplier, TIP_HIT, TIP_MISS, TIP_NOBODY, type OracleKind, type OracleQuestion, type OracleResult } from '../game/oracle';
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
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  pick: number;
}

interface Chip {
  label: string;
  pick: number;
  key?: string;
  /** The player's colour, for a name. */
  color?: string;
}

/** Every phase in which a question can be on screen. */
const ASKING = new Set(['aiming', 'flying']);

/** Splits a text with a `{name}` in it, so the name can be drawn in the player's colour. */
function aroundName(key: 'oracle.hitQ'): [string, string] {
  const [before, after = ''] = t(key, { name: '\u0001' }).split('\u0001');
  return [before, after];
}

/**
 * The oracle as the eliminated player sees it: a bar at the bottom edge with the question and the
 * choices (keys, or tap), a ring around the ship that was tipped, the verdict as a toast, and — when
 * the round is over — a strip with how everybody tipped.
 */
export class OracleHud {
  /** Where the choices were drawn last frame, for taps. */
  private hits: Hit[] = [];
  /** Height the live tips line takes above the bar this frame, so the verdict toast can sit above it. */
  private lift = 0;
  /** The verdict on show and since when. A verdict that falls during the killcam waits for it to end. */
  private shown: { match: Match | null; id: number; since: number } = { match: null, id: 0, since: 0 };

  /** The pick under a pointer (CSS pixels on the canvas), if it is over a choice. */
  hit(x: number, y: number): number | null {
    const found = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return found ? found.pick : null;
  }

  /** Called once per frame before anything is drawn. */
  begin(): void {
    this.hits = [];
    this.lift = 0;
  }

  /** Whether a question is on screen for this person. */
  asking(match: Match): boolean {
    return match.ghost && !!match.oracle.question && ASKING.has(match.phase);
  }

  // ————————————————————————————— The bar —————————————————————————————

  drawBar(f: OracleFrame, match: Match, touch: boolean): void {
    const q = match.oracle.question;
    if (!q) return;
    const { ctx, k, field } = f;
    const h = (touch ? 52 : 40) * k;
    const w = Math.min(field.w - 32 * k, 920 * k);
    const x = field.x + (field.w - w) / 2;
    const y = field.y + field.h - 16 * k - h;
    const mid = y + h / 2;

    ctx.fillStyle = rgba(COLORS.plate, 0.9);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x, y, 3 * k, h);
    if (!q.locked && q.kind === 'salvo') {
      // The salvo's shared clock runs out, and so does the time to tip.
      const clock = match.shotClock;
      if (clock !== null) ctx.fillRect(x + 3 * k, y + h - 2 * k, (w - 3 * k) * Math.max(0, Math.min(1, clock / HORIZON.SIMULTANEOUS_CLOCK)), 2 * k);
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.sodium;
    ctx.font = `700 ${10.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    const label = t('oracle.name').toUpperCase();
    ctx.fillText(label, x + 16 * k, mid + 0.5 * k);
    const labelRight = x + 16 * k + ctx.measureText(label).width;
    setSpacing(ctx, 0);

    const scoreW = this.drawScore(f, match, x + w - 14 * k, mid);
    ctx.textAlign = 'left';
    this.drawLiveTips(f, match, q, y);
    const left = labelRight + 18 * k;
    const right = x + w - 14 * k - scoreW - 16 * k;
    const me = match.viewer === null ? null : match.oracle.mine;
    const mine = me && me.id === q.id ? me.pick : null;

    if (q.locked) {
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `400 ${12.5 * k}px ${FONTS.body}`;
      const text = fitText(ctx, t('oracle.locked'), Math.max(0, right - left - 140 * k));
      ctx.fillText(text, left, mid + 0.5 * k);
      const after = left + ctx.measureText(text).width + 14 * k;
      this.drawTipChip(f, match, q, mine, after, mid, right - after, touch);
      return;
    }

    let cx = left;
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${13.5 * k}px ${FONTS.body}`;
    if (q.kind === 'shot') {
      const shooter = match.players[q.shooter];
      const [before, after] = aroundName('oracle.hitQ');
      for (const [text, color] of [[before, COLORS.bone], [shooter.name, shooter.color], [after, COLORS.bone]] as const) {
        ctx.fillStyle = color;
        ctx.fillText(text, cx, mid + 0.5 * k);
        cx += ctx.measureText(text).width;
      }
    } else {
      const text = t('oracle.salvoQ');
      ctx.fillText(text, cx, mid + 0.5 * k);
      cx += ctx.measureText(text).width;
    }
    this.drawChips(f, this.chipsFor(match, q, touch), mine, cx + 18 * k, mid, right - cx - 18 * k, touch);
  }

  private chipsFor(match: Match, q: OracleQuestion, touch: boolean): Chip[] {
    if (q.kind === 'shot') {
      return [
        { label: touch ? t('oracle.hit') : `← ${t('oracle.hit')}`, pick: TIP_HIT },
        { label: touch ? t('oracle.miss') : `${t('oracle.miss')} →`, pick: TIP_MISS },
      ];
    }
    const ships = q.choices.map((id, i): Chip => ({ label: match.players[id].name, pick: id, color: match.players[id].color, key: touch ? undefined : String(i + 1) }));
    return [...ships, { label: t('oracle.nobody'), pick: TIP_NOBODY, key: touch ? undefined : '0' }];
  }

  /** The choices as a row of keycap-like chips, squeezed (names cut short) to fit the room. */
  private drawChips(f: OracleFrame, chips: Chip[], selected: number | null, x: number, mid: number, room: number, touch: boolean): void {
    const { ctx, k } = f;
    const h = (touch ? 36 : 26) * k;
    const pad = 9 * k;
    const gap = 7 * k;
    const font = `700 ${12.5 * k}px ${FONTS.body}`;
    const keyFont = `700 ${10.5 * k}px ${FONTS.mono}`;
    const extras = (c: Chip) => pad * 2 + (c.key ? 15 * k : 0);
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
      const top = mid - h / 2;
      ctx.beginPath();
      ctx.roundRect(cx + 0.5, top + 0.5, w - 1, h - 1, 3 * k);
      if (on) {
        ctx.fillStyle = COLORS.sodium;
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba(COLORS.bone, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      let tx = cx + pad;
      ctx.textAlign = 'left';
      if (chip.key) {
        ctx.font = keyFont;
        ctx.fillStyle = on ? COLORS.plate : COLORS.boneDim;
        ctx.fillText(chip.key, tx, mid + 0.5 * k);
        tx += 15 * k;
      }
      ctx.font = font;
      ctx.fillStyle = on ? COLORS.plate : chip.color ?? COLORS.bone;
      ctx.fillText(text, tx, mid + 0.5 * k);
      this.hits.push({ x: cx, y: top, w, h, pick: chip.pick });
      cx += w + gap;
    });
  }

  /** What was tipped, once the tips are in: a filled chip, or "no tip". Not tappable. */
  private drawTipChip(f: OracleFrame, match: Match, q: OracleQuestion, pick: number | null, x: number, mid: number, room: number, touch: boolean): void {
    const { ctx, k } = f;
    const h = (touch ? 30 : 22) * k;
    const label = pick === null ? t('oracle.noTip') : this.pickLabel(match, q.kind, pick);
    ctx.font = `700 ${12 * k}px ${FONTS.body}`;
    const text = fitText(ctx, label, Math.max(40 * k, room - 24 * k));
    const w = ctx.measureText(text).width + 20 * k;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, mid - h / 2 + 0.5, w - 1, h - 1, 3 * k);
    if (pick === null) {
      ctx.strokeStyle = rgba(COLORS.bone, 0.25);
      ctx.stroke();
      ctx.fillStyle = COLORS.boneDim;
    } else {
      ctx.fillStyle = COLORS.sodium;
      ctx.fill();
      ctx.fillStyle = COLORS.plate;
    }
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 10 * k, mid + 0.5 * k);
  }

  /** The player's own points, and the multiplier while a streak runs. Returns the width taken. */
  private drawScore(f: OracleFrame, match: Match, right: number, mid: number): number {
    const { ctx, k } = f;
    const score = match.viewer === null ? undefined : match.oracle.scores[match.viewer];
    if (!score) return 0;
    // What the next right tip is worth.
    const streak = score.streak >= 1 ? ` ×${fmt(oracleMultiplier(score.streak + 1), 1).replace(/[.,]0$/, '')}` : '';
    ctx.textAlign = 'right';
    ctx.font = `700 ${12.5 * k}px ${FONTS.mono}`;
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

  /** "Dora ▸ Cleo   Emil ▸ Nobody" as coloured pieces; with `marks` each tip says whether it was right. */
  private tipSegments(match: Match, kind: OracleKind, tips: { player: number; pick: number; right?: boolean }[], marks: boolean): [string, string][] {
    const out: [string, string][] = [];
    tips.forEach((tip, i) => {
      const who = match.players[tip.player];
      const named = kind === 'salvo' && tip.pick >= 0 ? match.players[tip.pick] : undefined;
      if (i) out.push(['     ', COLORS.bone]);
      out.push([who.name, who.color], [' ▸ ', COLORS.boneDim], [this.pickLabel(match, kind, tip.pick), named?.color ?? COLORS.bone]);
      if (marks) out.push(tip.right ? [' ✓', COLORS.sodium] : [' ✕', COLORS.boneDim]);
    });
    return out;
  }

  private segmentsWidth(ctx: CanvasRenderingContext2D, segments: [string, string][]): number {
    return segments.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0);
  }

  private drawSegments(ctx: CanvasRenderingContext2D, segments: [string, string][], x: number, y: number): void {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [text, color] of segments) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  }

  /** The other eliminated players' tips as they come in, in a slim line above the bar. */
  private drawLiveTips(f: OracleFrame, match: Match, q: OracleQuestion, barTop: number): void {
    const tips = [...match.oracle.picks]
      .filter(([player]) => player !== match.viewer && match.players[player])
      .map(([player, pick]) => ({ player, pick }));
    if (!tips.length) return;
    const { ctx, k, field } = f;
    const h = 22 * k;
    ctx.font = `700 ${12 * k}px ${FONTS.body}`;
    // Squeezed into the field's width by leaving out the last tips, should there ever be too many.
    let shown = tips.length;
    let segments = this.tipSegments(match, q.kind, tips, false);
    while (shown > 1 && this.segmentsWidth(ctx, segments) + 32 * k > field.w - 48 * k) segments = this.tipSegments(match, q.kind, tips.slice(0, --shown), false);
    const w = this.segmentsWidth(ctx, segments) + 32 * k;
    const x = field.x + (field.w - w) / 2;
    const y = barTop - 8 * k - h;
    ctx.fillStyle = rgba(COLORS.plate, 0.85);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(COLORS.sodium, 0.6);
    ctx.fillRect(x, y, 3 * k, h);
    this.drawSegments(ctx, segments, x + 16 * k, y + h / 2 + 0.5 * k);
    this.lift = h + 8 * k;
  }

  // ————————————————————————————— On the field —————————————————————————————

  /** A ring around whoever the question is about, and around the ship that was tipped. */
  drawMarks(f: OracleFrame, match: Match): void {
    const q = match.oracle.question;
    if (!q || !ASKING.has(match.phase)) return;
    const { ctx, k } = f;
    const me = match.oracle.mine;
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

  // ————————————————————————————— The verdict —————————————————————————————

  /** "RIGHT +150 · Tom was hit". `top` places it in the killcam, where the bottom edge belongs to the replay. */
  drawToast(f: OracleFrame, match: Match, touch: boolean, killcam: boolean): void {
    const r = match.oracle.result;
    const viewer = match.viewer;
    if (!r || viewer === null || match.clock - r.at > 20) return;
    const mine = r.tips.find((tip) => tip.player === viewer);
    if (!mine) return;

    let alpha = 1;
    if (this.shown.match !== match || this.shown.id !== r.id) {
      // Wait out the killcam, then show it for a few seconds.
      if (killcam) alpha = 1;
      else this.shown = { match, id: r.id, since: f.time };
    } else if (!killcam) {
      const age = f.time - this.shown.since;
      if (age > ORACLE.RESULT_SECONDS) return;
      alpha = Math.min(1, (ORACLE.RESULT_SECONDS - age) / 0.5);
    }

    const { ctx, k, field } = f;
    const others = this.tipSegments(match, r.kind, r.tips.filter((tip) => tip.player !== viewer), true);
    const headline = this.headline(match, r);
    const lines = others.length ? 2 : 1;
    const h = (lines === 2 ? 44 : 28) * k;
    const verdict = mine.right ? t('oracle.right') : t('oracle.wrong');
    ctx.font = `800 ${14 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    const verdictW = ctx.measureText(verdict).width;
    setSpacing(ctx, 0);
    const points = mine.right ? `+${mine.points}` : '';
    ctx.font = `700 ${12.5 * k}px ${FONTS.mono}`;
    const pointsW = points ? ctx.measureText(points).width + 10 * k : 0;
    ctx.font = `400 ${12.5 * k}px ${FONTS.body}`;
    const headlineW = ctx.measureText(headline).width;
    ctx.font = `700 ${11.5 * k}px ${FONTS.body}`;
    const othersW = others.length ? this.segmentsWidth(ctx, others) : 0;
    const w = Math.min(field.w - 48 * k, Math.max(verdictW + pointsW + headlineW + 44 * k, othersW + 32 * k));
    const x = field.x + (field.w - w) / 2;
    const y = killcam
      ? field.y + Math.max(34 * k, field.h * 0.09) + 14 * k
      : field.y + field.h - 16 * k - (touch ? 52 : 40) * k - 12 * k - this.lift - h;
    const accent = mine.right ? COLORS.sodium : COLORS.boneDim;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(COLORS.plate, 0.9);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 3 * k, h);
    const mid = y + (lines === 2 ? 14 : h / 2) * k;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = x + 16 * k;
    ctx.font = `800 ${14 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    ctx.fillStyle = accent;
    ctx.fillText(verdict, cx, mid + 0.5 * k);
    setSpacing(ctx, 0);
    cx += verdictW + 10 * k;
    if (points) {
      ctx.font = `700 ${12.5 * k}px ${FONTS.mono}`;
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(points, cx, mid + 0.5 * k);
      cx += pointsW;
    }
    ctx.font = `400 ${12.5 * k}px ${FONTS.body}`;
    ctx.fillStyle = COLORS.boneDim;
    ctx.fillText(headline, cx + 8 * k, mid + 0.5 * k);
    if (others.length) {
      ctx.font = `700 ${11.5 * k}px ${FONTS.body}`;
      this.drawSegments(ctx, others, x + 16 * k, y + 32 * k);
    }
    ctx.globalAlpha = 1;
  }

  /** What the shots did, in a few words. */
  private headline(match: Match, r: OracleResult): string {
    if (r.kind === 'shot') return `${match.players[r.shooter].name}: ${r.hit ? t('oracle.out.hit') : t('oracle.out.miss')}`;
    return r.victims.length ? t('oracle.out.victims', { names: r.victims.map((id) => match.players[id].name).join(', ') }) : t('oracle.out.nobody');
  }

  // ————————————————————————————— Round over —————————————————————————————

  /** How everybody tipped this round, along the bottom edge of the scorecard. */
  drawStrip(f: OracleFrame, match: Match): void {
    const rows = match.oracle.roundRanking();
    const fade = Math.min(1, Math.max(0, (match.phaseTime - 0.9) / 0.5));
    if (!rows.length || fade <= 0) return;
    const { ctx, k, field } = f;
    const y = field.y + field.h - 54 * k;
    const label = t('oracle.name').toUpperCase();
    const size = 12.5 * k;

    const measure = (scale: number) => {
      ctx.font = `700 ${10.5 * k * scale}px ${FONTS.body}`;
      setSpacing(ctx, 1.8 * k * scale);
      let total = ctx.measureText(label).width + 18 * k * scale;
      setSpacing(ctx, 0);
      for (const { player, score } of rows) {
        ctx.font = `700 ${size * scale}px ${FONTS.body}`;
        total += ctx.measureText(match.players[player].name).width + 8 * k * scale;
        ctx.font = `700 ${size * scale}px ${FONTS.mono}`;
        total += ctx.measureText(`${score.roundRight}/${score.roundTotal}  +${score.roundPoints}`).width + 26 * k * scale;
      }
      return total;
    };
    const natural = measure(1);
    const scale = Math.min(1, (field.w - 48 * k) / natural);
    const width = natural * scale + 24 * k;
    const x = field.x + (field.w - width) / 2;

    ctx.globalAlpha = fade;
    ctx.fillStyle = rgba(COLORS.plate, 0.8);
    ctx.fillRect(x, y - 15 * k, width, 30 * k);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x, y - 15 * k, 3 * k, 30 * k);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = x + 16 * k;
    ctx.font = `700 ${10.5 * k * scale}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k * scale);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillText(label, cx, y + 0.5 * k);
    cx += ctx.measureText(label).width + 18 * k * scale;
    setSpacing(ctx, 0);
    rows.forEach(({ player, score }, i) => {
      const p = match.players[player];
      ctx.font = `700 ${size * scale}px ${FONTS.body}`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.name, cx, y + 0.5 * k);
      cx += ctx.measureText(p.name).width + 8 * k * scale;
      ctx.font = `700 ${size * scale}px ${FONTS.mono}`;
      const tally = `${score.roundRight}/${score.roundTotal}`;
      ctx.fillStyle = COLORS.bone;
      ctx.fillText(tally, cx, y + 0.5 * k);
      cx += ctx.measureText(`${tally}  `).width;
      ctx.fillStyle = i === 0 ? COLORS.sodium : COLORS.boneDim;
      ctx.fillText(`+${score.roundPoints}`, cx, y + 0.5 * k);
      cx += ctx.measureText(`+${score.roundPoints}`).width + 26 * k * scale;
    });
    ctx.globalAlpha = 1;
  }
}
