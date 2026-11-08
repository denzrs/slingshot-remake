import { modifiersOf } from '../sim/challenge';
import { AIM, COLORS, FONTS, MAYHEM, SUDDEN_DEATH, type Anomaly } from '../sim/config';
import { dangerColor, teamColor } from '../data/palette';
import { ChallengeMatch, ClassicMatch, HorizonMatch, SolarMatch, teamName, type KillRecord, type Mark, type Match, type PlayerState } from '../game';
import { fmt, fmtInt, t } from '../platform/i18n';
import { TWIST_IDS, twistName } from '../game/mayhem';
import { awardLabel, awardValue, awardWho, spotlight } from '../game/scorecard';
import { aimDirection, hasTrickShotSources } from '../sim/physics';
import { styleLabel } from '../sim/scoring';
import { awards } from '../data/stats';
import type { View } from './backdrop';
import { drawAvatar } from './avatar';
import { rgba } from './color';
import { plateUnits, rayHitsRect } from './layout';
import { OracleHud, type OracleFrame, type OracleTap } from './oracle';
import { SkipVoteHud, type SkipAnswer } from './skip-vote';
import { drawMarkSymbol, MARK_COLORS } from './mark-art';
import { drawPowerUpSymbol, POWER_UP_COLORS } from './powerup-art';
import { ANOMALY_COLORS, drawAnomalySymbol } from './anomaly-art';
import { anomaliesOf } from '../sim/anomalies';
import type { DrawOptions } from './renderer';
import { fitText, setSpacing } from './text';

/** On a phone held upright the duel's two blocks start this far lower (field units before `k`), under the round label and the pause button beside it. */
const DUEL_DROP = 24;

/** Cards narrower than this (field units) have no room for marks beside the score: they grow a row of their own for them, of this height. */
const MARK_ROOM = 132;
const MARK_ROW = 15;

/** The least a kill must pay beyond its points for the card to be outlined as the one worth the most. */
const MARK_STANDOUT = 200;

/** What a kill of a ship pays on top of its points, by the marks on its card: the comeback it may be in line for is not part of that. */
const killPayout = (marks: Mark[]): number => marks.reduce((sum, m) => sum + (m.kind === 'comeback' ? 0 : m.points), 0);

/** The marks most valuable first, a comeback (paid for the round, not for a kill) after every extra a kill pays. */
const byValue = (marks: Mark[]): Mark[] => [...marks].sort((a, b) => Number(a.kind === 'comeback') - Number(b.kind === 'comeback') || b.points - a.points);

/** The extra of a kill that pays most, which gives the card's total and outline their colour; call it only where a kill pays one. */
const topMark = (marks: Mark[]): Mark => byValue(marks)[0];

/** How many of `count` symbols, `r` big and `pitch` apart, fit in `room`. */
const fitMarks = (count: number, room: number, r: number, pitch: number): number => Math.max(0, Math.min(count, Math.floor((room + pitch - 2 * r) / pitch)));

type KeyItem = [key: string, label: string];
type Segment = [text: string, color: string];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything drawn in screen space on top of the field: scores, readouts, banners, hints. */
export class Hud {
  private lastTurn = -1;
  private turnAt = -10;
  private time = 0;
  /** The player asks for less motion: nothing tears or shakes. Read once. */
  private readonly calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private k = 1;
  private field: Box = { x: 0, y: 0, w: 0, h: 0 };
  /** The whole canvas, for what takes over the screen and not just the field. */
  private screen = { w: 0, h: 0 };
  private portrait = false;
  /** Whether the field is turned a quarter on screen (a phone held upright): aim directions then need turning with it. */
  private rotated = false;
  private readonly oracle = new OracleHud();
  private readonly skipVote = new SkipVoteHud();

  /** How far the duel's blocks sit lower on a phone held upright, where the round label's row is shared with the pause button. */
  private drop = 0;

  /** Where the aim card stands: the ship it belongs to, its place around the ship, and where it was last drawn. */
  private readoutSlot = { id: -1, slot: 0, x: 0, y: 0, seen: -1 };
  private shipPos: (i: number) => { x: number; y: number } = () => ({ x: 0, y: 0 });

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** The oracle choice under a pointer (CSS pixels on the canvas), if there is one. */
  oracleHit(x: number, y: number): OracleTap | null {
    return this.oracle.hit(x, y);
  }

  /** The answer to the vote to skip the round under a pointer (CSS pixels on the canvas), if there is one. */
  skipVoteHit(x: number, y: number): SkipAnswer | null {
    return this.skipVote.hit(x, y);
  }

  draw(match: Match, view: View, opts: DrawOptions, time: number, shipPos: (i: number) => { x: number; y: number }): void {
    this.time = time;
    this.shipPos = shipPos;
    this.portrait = !!view.stage;
    this.rotated = !!view.rotated;
    // On a phone the field is small, but its labels must stay readable: they get a higher floor.
    this.k = Math.min(1.2, Math.max(opts.touch ? 0.95 : 0.72, view.scale));
    this.screen = { w: view.cssWidth, h: view.cssHeight };
    const plate = plateUnits(!!view.rotated);
    this.field = view.stage ?? { x: view.offsetX, y: view.offsetY, w: plate.w * view.scale, h: plate.h * view.scale };

    const focus = match.focus;
    if (focus !== this.lastTurn) {
      this.lastTurn = focus;
      // In hot-seat games, say whose hands should be on the keyboard.
      if (focus >= 0 && !match.players[focus].cpu && match.humanCount > 1 && !match.simultaneous) this.turnAt = time;
    }

    this.oracle.begin();
    this.skipVote.begin();
    const frame: OracleFrame = { ctx: this.ctx, k: this.k, field: this.field, time, shipPos, keyHints: opts.keyHints && !opts.touch };
    const ghost = match.ghost;

    const killcam = match.killcamInfo;
    if (killcam) {
      this.drawKillcam(match, killcam, opts);
      this.skipVote.draw(frame, match, opts.touch);
      if (ghost) this.oracle.drawKillcamVerdict(frame, match, opts.touch);
      return;
    }

    if (match instanceof ChallengeMatch) {
      this.drawChallenge(match, opts);
      return;
    }

    const duel = match.mode === 'classic' && match.players.length === 2;
    this.drop = duel && view.stage ? DUEL_DROP * this.k : 0;
    this.drawRoundLabel(match);
    this.drawTwistChips(match);
    // Worked out once a frame: the blocks, the cards and their outline all read the same.
    const marks = match.phase === 'aiming' ? match.cardMarks : [];
    if (duel) {
      this.drawDuelBlock(match, match.players[0], 'left', marks);
      this.drawDuelBlock(match, match.players[1], 'right', marks);
    } else {
      this.drawScoreboard(match, marks);
      this.drawKillFeed(match);
    }
    if (match.phase === 'aiming' && focus >= 0 && match.aimVisible(focus)) this.drawReadout(match, match.players[focus], shipPos(focus), opts.aimCardDodge);
    this.drawNotice(match);
    this.skipVote.draw(frame, match, opts.touch);
    // The oracle's card holds the question — or the round's summary — at the bottom edge; it already names whose shot it is.
    this.oracle.plan(frame, match, opts.touch, ghost);
    const asking = this.oracle.asking;
    // The living feel the ghosts' mood over the shooter's ship.
    if (!ghost) this.oracle.drawMood(frame, match);
    if (ghost) this.oracle.drawMarks(frame, match);
    if (time - this.turnAt < 1.6 && focus >= 0 && !asking) this.drawTurnToast(match.players[focus]);
    if (match.phase === 'roundOver' && match.summary) {
      this.drawBanner(match, duel);
      this.drawScorecard(match);
    }
    this.oracle.drawCard(frame, match, opts.touch);
    if (!asking && !match.revealing) this.drawHint(match, opts.touch);
    if (match.revealing) {
      const hasMayhem = match.mayhem !== null;
      const hasAnomalies = match.anomalyAlert && anomaliesOf(match.rules).length > 0;
      if (hasMayhem && hasAnomalies) {
        this.drawCombinedReveal(match);
      } else if (hasMayhem) {
        this.drawReveal(match);
      } else if (hasAnomalies) {
        this.drawAnomalyAlert(match);
      }
    }
    if (opts.recording) this.drawRec();
  }

  // ————————————————————————————— Top row —————————————————————————————

  private drawRoundLabel(match: Match): void {
    const { ctx, k, field } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${24 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    let label = match.totalRounds ? `${t('hud.round')} ${match.round} / ${match.totalRounds}` : `${t('hud.round')} ${match.round}`;
    if (match instanceof HorizonMatch) label += `  ·  ${t('hud.volley')} ${match.volleyNo}`;
    // Sudden death: counted down over its last few passes, then shown in red for as long as the round lasts.
    const left = match instanceof ClassicMatch && match.phase !== 'roundOver' && match.phase !== 'gameOver' ? match.suddenDeathIn : null;
    const warning = left !== null && left <= SUDDEN_DEATH.WARNING ? `  ·  ${left ? t('hud.suddenDeathIn', { n: left }) : t('hud.suddenDeath')}` : '';
    const headerWidth = ctx.measureText(label).width + (warning ? ctx.measureText(warning).width : 0);
    // On a narrow phone the centered heading can reach into the pause button's expanded hit area.
    const cx = this.portrait ? Math.max(field.x + field.w / 2, 58 + headerWidth / 2) : field.x + field.w / 2;
    const y = field.y + 18 * k;
    if (!warning) ctx.fillText(label, cx, y);
    else {
      const a = ctx.measureText(label).width;
      const start = cx - (a + ctx.measureText(warning).width) / 2;
      ctx.textAlign = 'left';
      ctx.fillText(label, start, y);
      ctx.fillStyle = left ? COLORS.sodium : rgba(COLORS.danger, 0.7 + 0.3 * Math.sin(this.time * 5));
      ctx.fillText(warning, start + a, y);
    }
    setSpacing(ctx, 0);
  }

  // ————————————————————————————— Mayhem —————————————————————————————

  /**
   * The round's twists and the match's anomalies as chips under the round label, so nobody forgets what this round is
   * about. The Zeitzünder chip says how long this round's fuse burns.
   */
  private drawTwistChips(match: Match): void {
    const round = match.mayhem;
    const rules = match.rules;
    const labels: string[] = [];
    const colors: string[] = [];
    if (rules.trickShots || match.settings.anomalies?.includes('trickShots')) {
      const active = hasTrickShotSources(match.world, rules);
      labels.push(active ? t('anomaly.trickShots') : t('notice.freeFire'));
      colors.push(active ? ANOMALY_COLORS.trickShots : COLORS.danger);
    }
    if (rules.pinball) {
      labels.push(t('anomaly.pinball'));
      colors.push(ANOMALY_COLORS.pinball);
    }
    if (rules.fuse) {
      labels.push(t('anomaly.fuseIn', { n: fmt(rules.fuse, 1) }));
      colors.push(ANOMALY_COLORS.fuse);
    }
    if (rules.fusion) {
      labels.push(t('anomaly.fusion'));
      colors.push(ANOMALY_COLORS.fusion);
    }
    for (const anomaly of ['whiteHole', 'unstable'] as const) {
      if (!rules[anomaly]) continue;
      labels.push(t(`anomaly.${anomaly}`));
      colors.push(ANOMALY_COLORS[anomaly]);
    }
    // The anomalies' chips are the first of them: they tear now and then, like the alarm's headline.
    const anomalyChips = labels.length;
    if (!round && !labels.length) return;
    if (round?.finale) {
      labels.push(t('mayhem.finale'));
      colors.push(COLORS.danger);
    }
    for (const twist of round?.twists ?? []) {
      labels.push(twistName(twist));
      colors.push(COLORS.sodium);
    }
    if (round?.jackpot) {
      labels.push(t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR }));
      colors.push(COLORS.danger);
    }
    if (round && !round.twists.length && !round.finale && !round.jackpot) {
      labels.push(t('mayhem.quiet'));
      colors.push(COLORS.boneDim);
    }
    // The duel has its blocks in the corners; with a scoreboard across the top the chips go under it (and under its power-up strip).
    const duel = match.mode === 'classic' && match.players.length === 2;
    const below = duel ? 34 : (match.teamMode ? 66 : 50) + 40 + this.markRowHeight(match) + (match.powerUps ? 32 : 10);
    this.drawChips(labels, this.field.x + this.field.w / 2, this.field.y + (below + (duel ? 18 : 0)) * this.k + this.drop, colors, anomalyChips);
  }

  /**
   * The announcement of a Mayhem round: a band over the field in which each twist spins like a reel, slows down
   * and lands on its name, one after the other; the last lands together with the thud of the sound.
   */
  /** How tall the band of a Mayhem round's announcement is. */
  private revealHeight(round: NonNullable<Match['mayhem']>): number {
    const { k } = this;
    return 62 * k + Math.max(1, round.twists.length) * 76 * k + (round.jackpot ? 40 * k : 0) + 38 * k;
  }

  /**
   * The opacity and elapsed time of a round announcement / anomaly alert:
   * smoothstep fade-in over 0.4 s (matching banners), and a fade-out over 0.35 s when closing.
   */
  private revealAlpha(match: Match): { alpha: number; age: number } {
    const left = match.revealEnd - match.clock;
    const age = MAYHEM.REVEAL_TIME - left;
    const fadeIn = Math.min(1, Math.max(0, age / 0.4));
    const easeIn = fadeIn * fadeIn * (3 - 2 * fadeIn);
    const fadeOut = match.held ? 1 : Math.max(0, Math.min(1, left / 0.35));
    return { alpha: easeIn * fadeOut, age };
  }

  /**
   * Anomalies: the alarm that opens a match that plays by them, like a ship's red alert. The screen flushes red at its
   * edges and pulses with the klaxon, a dark band with red edges and scanlines goes across, the headline comes in on a
   * broken signal (its colours torn apart and jittering, then holding, and now and then tearing again), and the
   * anomalies come up one after another, typed out in their colours. With Mayhem's reel it stands right above it.
   */
  private drawAnomalyAlert(match: Match): void {
    const anomalies = anomaliesOf(match.rules);
    const { ctx, k, field, screen } = this;
    const { alpha, age } = this.revealAlpha(match);
    if (alpha <= 0 || !anomalies.length) return;
    const cx = field.x + field.w / 2;
    // The band's red edges, and the space kept inside them.
    const stripe = 4 * k;
    const lineH = 15 * k;
    /** Small print broken into as many lines as the field needs, four at most, each cut short only if a single word is too wide. */
    const wrap = (text: string, size: number, spacing = 0): string[] => {
      const width = field.w - 40 * k;
      ctx.font = `400 ${size}px ${FONTS.mono}`;
      setSpacing(ctx, spacing);
      const lines: string[] = [];
      let line = '';
      for (const word of text.split(' ')) {
        const longer = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(longer).width > width) {
          lines.push(line);
          line = word;
        } else line = longer;
      }
      if (line) lines.push(line);
      const kept = lines.slice(0, 4).map((l) => fitText(ctx, l, width));
      setSpacing(ctx, 0);
      return kept;
    };
    const info = wrap(t('anomaly.alertInfo').toUpperCase(), 11 * k, 2 * k);
    const foot = match.mayhem ? 16 * k : 40 * k;
    const head = stripe + 80 * k + info.length * lineH;
    // Room the band may take: below the round label and chips at the field's top, above the controls at its bottom.
    const room = field.h - 110 * k;
    const lay = (explain: boolean) => {
      const hints = anomalies.map((anomaly) => (explain ? wrap(t(`anomaly.${anomaly}.hint`), 11.5 * k) : []));
      const rows = hints.map((lines) => (explain ? 34 * k + lines.length * lineH + 8 * k : 40 * k));
      return { hints, rows, h: head + rows.reduce((sum, row) => sum + row, 0) + foot };
    };
    // Many anomalies on a small screen: say what each one is, not what it does (the rules page has the rest).
    let { hints, rows, h } = lay(true);
    if (h > room) ({ hints, rows, h } = lay(false));
    const middle = field.y + field.h / 2;
    const top = match.mayhem
      ? Math.max(8 * k, middle - this.revealHeight(match.mayhem) / 2 - 14 * k - h)
      : Math.max(field.y + 56 * k, middle - h / 2);
    const pulse = 0.5 + 0.5 * Math.sin(age * 7.5);
    const ink = '#14070c';

    ctx.save();
    ctx.globalAlpha = alpha;
    // The red alert: unless Mayhem's announcement has dimmed the field already, it goes dark, and red creeps in from the edges.
    if (!match.mayhem) {
      ctx.fillStyle = rgba(COLORS.plate, 0.6);
      ctx.fillRect(0, 0, screen.w, screen.h);
    }
    const reach = Math.max(screen.w, screen.h);
    const flush = ctx.createRadialGradient(screen.w / 2, screen.h / 2, reach * 0.18, screen.w / 2, screen.h / 2, reach * 0.72);
    flush.addColorStop(0, rgba(COLORS.danger, 0));
    flush.addColorStop(1, rgba(COLORS.danger, 0.16 + 0.24 * pulse));
    ctx.fillStyle = flush;
    ctx.fillRect(0, 0, screen.w, screen.h);

    // The band: dark red glass between two glowing red edges, scanlines drifting down over it.
    ctx.fillStyle = rgba(ink, 0.95);
    ctx.fillRect(0, top, screen.w, h);
    for (const y of [top, top + h]) {
      const glow = ctx.createLinearGradient(0, y - 16 * k, 0, y + 16 * k);
      glow.addColorStop(0, rgba(COLORS.danger, 0));
      glow.addColorStop(0.5, rgba(COLORS.danger, 0.22 + 0.18 * pulse));
      glow.addColorStop(1, rgba(COLORS.danger, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, y - 16 * k, screen.w, 32 * k);
      ctx.fillStyle = rgba(COLORS.danger, 0.9);
      ctx.fillRect(0, y - 1, screen.w, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    const line = Math.max(3, 3 * k);
    for (let y = top + stripe + ((age * 36) % line); y < top + h - stripe; y += line) ctx.fillRect(0, y, screen.w, 1);

    // The headline comes in on a broken signal: the colours torn apart and shaking, settling within a second, and tearing again now and then.
    const title = t('anomaly.alert').toUpperCase();
    const ty = top + stripe + 40 * k;
    const calm = this.calm;
    const settle = calm ? 0 : Math.max(0, 1 - age / 0.9);
    const tear = calm ? 0 : (Math.sin(age * 5.3) > 0.93 ? 1 : 0);
    const jitter = (settle + tear * 0.7) * 7 * k;
    const dx = jitter * Math.sin(age * 83);
    const dy = jitter * 0.35 * Math.cos(age * 71);
    const flicker = !calm && age < 0.45 && Math.sin(age * 95) < -0.35 ? 0.3 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.fitDisplay(title, 46 * k, 6 * k, field.w - 140 * k);
    const titleW = ctx.measureText(title).width;
    ctx.globalAlpha = alpha * flicker * 0.75;
    ctx.fillStyle = '#3ff0ff';
    ctx.fillText(title, cx - 3 * k - dx, ty - dy);
    ctx.fillStyle = COLORS.danger;
    ctx.fillText(title, cx + 3 * k + dx, ty + dy);
    ctx.globalAlpha = alpha * flicker;
    ctx.fillStyle = '#ffe3e6';
    ctx.fillText(title, cx + dx * 0.3, ty);
    setSpacing(ctx, 0);
    // Warning signs either side of it, blinking with the klaxon.
    ctx.globalAlpha = alpha * (0.45 + 0.55 * pulse);
    for (const side of [-1, 1]) this.warningSign(cx + side * (titleW / 2 + 34 * k), ty, 15 * k);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff8d99';
    ctx.font = `400 ${11 * k}px ${FONTS.mono}`;
    setSpacing(ctx, 2 * k);
    info.forEach((text, n) => ctx.fillText(text, cx, ty + 36 * k + n * lineH));
    setSpacing(ctx, 0);

    // The anomalies come up one after another, each typed out in its colour, its symbol beside it and what it does beneath.
    let rowTop = top + head;
    anomalies.forEach((anomaly, i) => {
      const y = rowTop + 14 * k;
      rowTop += rows[i];
      const at = 0.5 + i * 0.22;
      if (age < at) return;
      const name = t(`anomaly.${anomaly}`).toUpperCase();
      const typed = Math.min(name.length, Math.floor((age - at) * 34));
      const color = ANOMALY_COLORS[anomaly];
      ctx.globalAlpha = alpha;
      this.fitDisplay(name, 26 * k, 3 * k, field.w - 160 * k);
      const nameW = ctx.measureText(name).width;
      const x0 = cx - nameW / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.fillText(name.slice(0, typed) + (typed < name.length ? '▌' : ''), x0, y);
      setSpacing(ctx, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8 * k;
      drawAnomalySymbol(ctx, anomaly, x0 - 24 * k, y, 10 * k);
      if (typed < name.length) return;
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `400 ${11.5 * k}px ${FONTS.mono}`;
      hints[i].forEach((text, n) => ctx.fillText(text, cx, y + 24 * k + n * lineH));
    });

    // Alone it says how to go on; with Mayhem's reel below, the reel does.
    if (!match.mayhem && age > MAYHEM.LANDED) {
      ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(age * 4));
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `700 ${11 * k}px ${FONTS.body}`;
      setSpacing(ctx, 2 * k);
      ctx.fillText(t(match.canAdvance ? 'mayhem.skip' : 'hud.waitingHost').toUpperCase(), cx, top + h - stripe - foot / 2);
      setSpacing(ctx, 0);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
  }

  /** A warning sign centred on (x, y), `r` from its middle to a corner: a red triangle with an exclamation mark. */
  private warningSign(x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 1.1, y + r * 0.8);
    ctx.lineTo(x - r * 1.1, y + r * 0.8);
    ctx.closePath();
    ctx.fillStyle = COLORS.danger;
    ctx.fill();
    ctx.fillStyle = '#14070c';
    ctx.fillRect(x - r * 0.09, y - r * 0.45, r * 0.18, r * 0.75);
    ctx.fillRect(x - r * 0.09, y + r * 0.45, r * 0.18, r * 0.18);
  }

  private drawReveal(match: Match): void {
    const round = match.mayhem;
    if (!round) return;
    const { ctx, k, field } = this;
    const { alpha, age } = this.revealAlpha(match);
    if (alpha <= 0) return;
    const cx = field.x + field.w / 2;
    const cy = field.y + field.h / 2;
    const rows = Math.max(1, round.twists.length);
    const rowH = 76 * k;
    const head = 62 * k;
    const foot = 38 * k;
    const jackpotH = round.jackpot ? 40 * k : 0;
    const h = this.revealHeight(round);
    const top = cy - h / 2;
    // The reels stop one after another, the last one at the thud.
    const landed = MAYHEM.LANDED;
    const stopAt = (i: number) => landed - 0.25 * (rows - 1 - i);

    ctx.globalAlpha = alpha;
    this.takeOver(top, h, round.finale ? COLORS.danger : COLORS.sodium, 0.62, 0.92);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = round.finale ? COLORS.danger : COLORS.boneDim;
    ctx.font = `800 ${(round.finale ? 26 : 16) * k}px ${FONTS.display}`;
    setSpacing(ctx, 5 * k);
    ctx.fillText(round.finale ? t('mayhem.finale') : t('mayhem.round', { n: match.round }), cx, top + head / 2);
    setSpacing(ctx, 0);

    if (!round.twists.length) {
      ctx.fillStyle = COLORS.bone;
      ctx.font = `800 ${44 * k}px ${FONTS.display}`;
      setSpacing(ctx, 4 * k);
      ctx.fillText(t('mayhem.quiet'), cx, top + head + rowH * 0.4);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `400 ${13 * k}px ${FONTS.mono}`;
      ctx.fillText(t('mayhem.quietInfo'), cx, top + head + rowH * 0.8);
    }
    round.twists.forEach((twist, i) => {
      const y = top + head + rowH * i + rowH * 0.4;
      const stop = stopAt(i);
      if (age < stop) {
        // Spinning: the faces flick past, slower and slower as the stop comes near.
        const progress = age / stop;
        const face = Math.floor(age * 18 * (1 - progress * 0.65)) + i * 5;
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = COLORS.bone;
        const spinning = t(`mayhem.twist.${TWIST_IDS[face % TWIST_IDS.length]}`);
        this.fitDisplay(spinning, 40 * k, 4 * k, field.w - 32 * k);
        ctx.fillText(spinning, cx, y);
        setSpacing(ctx, 0);
        ctx.globalAlpha = alpha;
        return;
      }
      const since = age - stop;
      const pop = since < 0.15 ? 1.3 - (since / 0.15) * 0.3 : 1;
      ctx.fillStyle = COLORS.sodium;
      this.fitDisplay(twistName(twist), 44 * k * pop, 4 * k, field.w - 32 * k);
      ctx.fillText(twistName(twist), cx, y);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `400 ${13 * k}px ${FONTS.mono}`;
      ctx.fillText(t(`mayhem.twist.${twist.id}.info`, { n: twist.n ?? 0 }), cx, y + 34 * k);
    });

    if (round.jackpot && age > landed + 0.1) {
      const pulse = 0.75 + 0.25 * Math.sin(age * 9);
      const y = top + head + rows * rowH + jackpotH / 2;
      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = COLORS.danger;
      const jackpot = t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR });
      this.fitDisplay(jackpot, 26 * k, 5 * k, field.w - 32 * k);
      ctx.fillText(jackpot, cx, y - 6 * k);
      setSpacing(ctx, 0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `400 ${12 * k}px ${FONTS.mono}`;
      ctx.fillText(t('mayhem.jackpotInfo'), cx, y + 15 * k);
    }

    if (age > landed) {
      ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(age * 4));
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `700 ${11 * k}px ${FONTS.body}`;
      setSpacing(ctx, 2 * k);
      ctx.fillText(t(match.canAdvance ? 'mayhem.skip' : 'hud.waitingHost').toUpperCase(), cx, top + h - foot / 2);
      setSpacing(ctx, 0);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
  }

  /**
   * Combined round announcement: when the round brings both Mayhem twists and match anomalies.
   * Instead of two independent overlapping full-screen bands, renders a unified tactical briefing:
   * on desktop / wide fields, a two-column briefing (Sector Anomalies on the left with emergency glitch/hazard,
   * Round Twists on the right with the spinning reel); on narrow / portrait fields, a compact integrated stack.
   */
  private drawCombinedReveal(match: Match): void {
    const round = match.mayhem;
    const anomalies = anomaliesOf(match.rules);
    if (!round && !anomalies.length) return;
    if (!round) {
      this.drawAnomalyAlert(match);
      return;
    }
    if (!anomalies.length) {
      this.drawReveal(match);
      return;
    }

    const { ctx, k, field, screen } = this;
    const { alpha, age } = this.revealAlpha(match);
    if (alpha <= 0) return;

    const cx = field.x + field.w / 2;
    const cy = field.y + field.h / 2;
    const landed = MAYHEM.LANDED;
    const pulse = 0.5 + 0.5 * Math.sin(age * 7.5);
    const isWide = field.w >= 660 * k && !this.portrait;

    const wrap = (text: string, size: number, maxWidth: number, maxLines = 3): string[] => {
      ctx.font = `400 ${size}px ${FONTS.mono}`;
      setSpacing(ctx, 0);
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines.slice(0, maxLines).map((l) => fitText(ctx, l, maxWidth));
    };

    const aCount = anomalies.length;
    const twists = round.twists;
    const tCount = Math.max(1, twists.length);
    const rightEdgeColor = round.finale ? COLORS.danger : COLORS.sodium;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Ambient red alert flush vignette at screen edges
    const reach = Math.max(screen.w, screen.h);
    const flush = ctx.createRadialGradient(screen.w / 2, screen.h / 2, reach * 0.18, screen.w / 2, screen.h / 2, reach * 0.72);
    flush.addColorStop(0, rgba(COLORS.danger, 0));
    flush.addColorStop(1, rgba(COLORS.danger, 0.12 + 0.16 * pulse));
    ctx.fillStyle = flush;
    ctx.fillRect(0, 0, screen.w, screen.h);

    if (isWide) {
      // -------------------------------------------------------------
      // WIDE LAYOUT: Two-Column Tactical Briefing
      // -------------------------------------------------------------
      const briefingW = Math.min(field.w - 32 * k, 1140 * k);
      const colGap = 40 * k;
      const colW = (briefingW - colGap) / 2;
      const leftColX = cx - colGap / 2 - colW;
      const rightColX = cx + colGap / 2;

      const headH = 32 * k;
      const footH = 36 * k;

      // Anomalies sizing
      const aRowH = aCount === 1 ? 66 * k : aCount <= 3 ? 52 * k : 42 * k;
      const aNameSize = (aCount === 1 ? 22 : aCount <= 3 ? 17 : 14) * k;
      const aHintSize = (aCount === 1 ? 12 : aCount <= 3 ? 11 : 10) * k;
      const aLineH = (aCount <= 3 ? 14 : 12.5) * k;
      const aHints = anomalies.map((a) => wrap(t(`anomaly.${a}.hint`), aHintSize, colW - 32 * k, aCount > 3 ? 2 : 3));
      const leftListH = headH + aCount * aRowH + 8 * k;

      // Twists sizing
      const tRowH = twists.length === 0 ? 58 * k : twists.length === 1 ? 72 * k : twists.length === 2 ? 60 * k : 46 * k;
      const tNameSize = (twists.length <= 1 ? 38 : twists.length === 2 ? 28 : 22) * k;
      const tInfoSize = (twists.length <= 2 ? 12 : 10.5) * k;
      const jackpotH = round.jackpot ? 34 * k : 0;
      const rightListH = headH + (twists.length === 0 ? 58 * k : twists.length * tRowH) + jackpotH + 8 * k;

      const bodyH = Math.max(leftListH, rightListH);
      const h = bodyH + footH + 16 * k;
      const top = Math.max(field.y + 60 * k, Math.min(field.y + field.h - h - 36 * k, cy - h / 2));

      // Container band background
      ctx.fillStyle = 'rgba(8, 11, 20, 0.95)';
      ctx.fillRect(0, top, screen.w, h);

      // Glowing edge lines: gradient from Danger (left) to Sodium/Danger (right)
      const edgeGrad = ctx.createLinearGradient(leftColX, 0, rightColX + colW, 0);
      edgeGrad.addColorStop(0, COLORS.danger);
      edgeGrad.addColorStop(0.42, COLORS.danger);
      edgeGrad.addColorStop(0.58, rightEdgeColor);
      edgeGrad.addColorStop(1, rightEdgeColor);

      for (const y of [top, top + h]) {
        const glow = ctx.createLinearGradient(0, y - 14 * k, 0, y + 14 * k);
        glow.addColorStop(0, 'rgba(0,0,0,0)');
        glow.addColorStop(0.5, rgba(COLORS.plate, 0.35));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, y - 14 * k, screen.w, 28 * k);

        ctx.fillStyle = edgeGrad;
        ctx.fillRect(0, y - 1, screen.w, 2);
      }

      // Scanlines drifting across
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      const scanStep = Math.max(3, 3 * k);
      for (let y = top + 3 * k + ((age * 36) % scanStep); y < top + h - 3 * k; y += scanStep) {
        ctx.fillRect(0, y, screen.w, 1);
      }

      // Center vertical divider between columns
      const divGrad = ctx.createLinearGradient(0, top + 14 * k, 0, top + h - footH);
      divGrad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
      divGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.12)');
      divGrad.addColorStop(0.8, 'rgba(255, 255, 255, 0.12)');
      divGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = divGrad;
      ctx.fillRect(cx - 0.5, top + 14 * k, 1, h - footH - 14 * k);

      const headY = top + 22 * k;

      // --- Left Column: Anomalies ---
      const aTitle = (aCount > 1 ? t('setup.group.anomalies') : t('anomaly.alert')).toUpperCase();
      const settle = Math.max(0, 1 - age / 0.8);
      const tear = Math.sin(age * 5.3) > 0.94 ? 1 : 0;
      const jitter = (settle + tear * 0.7) * 3 * k;
      const dx = jitter * Math.sin(age * 83);
      const dy = jitter * 0.3 * Math.cos(age * 71);
      const flicker = age < 0.4 && Math.sin(age * 95) < -0.3 ? 0.2 : 1;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      ctx.globalAlpha = alpha * (0.45 + 0.55 * pulse);
      this.warningSign(leftColX + 10 * k, headY, 8.5 * k);
      ctx.globalAlpha = alpha;

      ctx.font = `800 ${14 * k}px ${FONTS.display}`;
      setSpacing(ctx, 3 * k);
      if (flicker < 1) {
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#3ff0ff';
        ctx.fillText(aTitle, leftColX + 26 * k - dx, headY - dy);
        ctx.fillStyle = COLORS.danger;
        ctx.fillText(aTitle, leftColX + 26 * k + dx, headY + dy);
        ctx.globalAlpha = alpha;
      }
      ctx.fillStyle = '#ffe3e6';
      ctx.fillText(aTitle, leftColX + 26 * k, headY);
      setSpacing(ctx, 0);

      const aListTop = headY + 18 * k;
      const aStagger = Math.min(0.18, 0.65 / Math.max(1, aCount));
      anomalies.forEach((anomaly, i) => {
        const at = 0.3 + i * aStagger;
        if (age < at) return;
        const itemY = aListTop + i * aRowH + 10 * k;
        const name = t(`anomaly.${anomaly}`).toUpperCase();
        const typed = Math.min(name.length, Math.floor((age - at) * 38));
        const color = ANOMALY_COLORS[anomaly];

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.6 * k;
        drawAnomalySymbol(ctx, anomaly, leftColX + 10 * k, itemY, 8 * k);

        ctx.font = `800 ${aNameSize}px ${FONTS.display}`;
        setSpacing(ctx, 2 * k);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.slice(0, typed) + (typed < name.length ? '▌' : ''), leftColX + 24 * k, itemY);
        setSpacing(ctx, 0);

        if (typed >= name.length) {
          ctx.fillStyle = '#c8d2e8';
          ctx.font = `400 ${aHintSize}px ${FONTS.mono}`;
          ctx.textBaseline = 'top';
          aHints[i].forEach((line, lineIdx) => {
            ctx.fillText(line, leftColX + 24 * k, itemY + (aCount <= 3 ? 12 : 9) * k + lineIdx * aLineH);
          });
        }
      });

      // --- Right Column: Mayhem Twists ---
      const rHeadTitle = round.finale ? t('mayhem.finale').toUpperCase() : t('mayhem.round', { n: match.round }).toUpperCase();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = round.finale ? COLORS.danger : COLORS.boneDim;
      ctx.font = `800 ${14 * k}px ${FONTS.display}`;
      setSpacing(ctx, 3 * k);
      ctx.fillText(rHeadTitle, rightColX, headY);
      setSpacing(ctx, 0);

      const rListTop = headY + 18 * k;
      const stopAt = (i: number) => landed - 0.2 * (tCount - 1 - i);

      if (!twists.length) {
        const y = rListTop + 14 * k;
        ctx.fillStyle = COLORS.bone;
        ctx.font = `800 ${26 * k}px ${FONTS.display}`;
        setSpacing(ctx, 3 * k);
        ctx.fillText(t('mayhem.quiet'), rightColX, y);
        setSpacing(ctx, 0);
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `400 ${12 * k}px ${FONTS.mono}`;
        ctx.textBaseline = 'top';
        ctx.fillText(t('mayhem.quietInfo'), rightColX, y + 16 * k);
      } else {
        twists.forEach((twist, i) => {
          const itemY = rListTop + i * tRowH + 12 * k;
          const stop = stopAt(i);
          if (age < stop) {
            const progress = age / stop;
            const face = Math.floor(age * 18 * (1 - progress * 0.65)) + i * 5;
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillStyle = COLORS.bone;
            const spinning = t(`mayhem.twist.${TWIST_IDS[face % TWIST_IDS.length]}`);
            this.fitDisplay(spinning, tNameSize * 0.9, 3 * k, colW - 16 * k);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(spinning, rightColX, itemY);
            setSpacing(ctx, 0);
            ctx.globalAlpha = alpha;
            return;
          }

          const since = age - stop;
          const pop = since < 0.14 ? 1.25 - (since / 0.14) * 0.25 : 1;
          ctx.fillStyle = COLORS.sodium;
          this.fitDisplay(twistName(twist), tNameSize * pop, 3 * k, colW - 16 * k);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(twistName(twist), rightColX, itemY);
          setSpacing(ctx, 0);

          ctx.fillStyle = COLORS.boneDim;
          ctx.font = `400 ${tInfoSize}px ${FONTS.mono}`;
          ctx.textBaseline = 'top';
          const info = t(`mayhem.twist.${twist.id}.info`, { n: twist.n ?? 0 });
          const infoLines = wrap(info, tInfoSize, colW - 16 * k, 2);
          infoLines.forEach((line, lineIdx) => {
            ctx.fillText(line, rightColX, itemY + (tCount <= 2 ? 14 : 10) * k + lineIdx * (tInfoSize + 3 * k));
          });
        });
      }

      if (round.jackpot && age > landed + 0.1) {
        const jPulse = 0.75 + 0.25 * Math.sin(age * 9);
        const jY = rListTop + (twists.length === 0 ? 58 * k : twists.length * tRowH) + 12 * k;
        ctx.globalAlpha = alpha * jPulse;
        ctx.fillStyle = COLORS.danger;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const jackpotLabel = t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR });
        this.fitDisplay(jackpotLabel, 18 * k, 3 * k, colW - 16 * k);
        ctx.fillText(jackpotLabel, rightColX, jY);
        setSpacing(ctx, 0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `400 ${10.5 * k}px ${FONTS.mono}`;
        ctx.textBaseline = 'top';
        ctx.fillText(t('mayhem.jackpotInfo'), rightColX, jY + 12 * k);
      }

      // Unified skip footer
      if (age > landed) {
        ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(age * 4));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `700 ${11 * k}px ${FONTS.body}`;
        setSpacing(ctx, 2 * k);
        ctx.fillText(t(match.canAdvance ? 'mayhem.skip' : 'hud.waitingHost').toUpperCase(), cx, top + h - 16 * k);
        setSpacing(ctx, 0);
      }
    } else {
      // -------------------------------------------------------------
      // NARROW / PORTRAIT LAYOUT: Integrated Centered Stacked Briefing
      // -------------------------------------------------------------
      const maxTextW = field.w - 36 * k;
      const headH = 36 * k;
      const footH = 34 * k;

      // Anomalies sizing
      const aHints = anomalies.map((a) => wrap(t(`anomaly.${a}.hint`), 10.5 * k, maxTextW, aCount <= 2 ? 2 : 1));
      const aHintLineH = 13.5 * k;
      const aRowH = aCount === 1 ? 58 * k : aCount === 2 ? 50 * k : 38 * k;
      const aNameSize = (aCount === 1 ? 20 : aCount === 2 ? 16 : 13.5) * k;
      const aHintSize = (aCount <= 2 ? 11 : 10) * k;
      const aSectionH = aCount * aRowH + 6 * k;

      // Twists sizing
      const tInfoLines = twists.map((twist) => wrap(t(`mayhem.twist.${twist.id}.info`, { n: twist.n ?? 0 }), 10.5 * k, maxTextW, twists.length <= 2 ? 2 : 1));
      const tRowH = twists.length === 0 ? 46 * k : twists.length === 1 ? 64 * k : twists.length === 2 ? 52 * k : 40 * k;
      const tNameSize = (twists.length <= 1 ? 28 : twists.length === 2 ? 22 : 18) * k;
      const tInfoSize = (twists.length <= 2 ? 11 : 10) * k;
      const jackpotH = round.jackpot ? 32 * k : 0;
      const tSectionH = (twists.length === 0 ? 46 * k : twists.length * tRowH) + jackpotH + 6 * k;

      const totalContentH = headH + aSectionH + 14 * k + tSectionH + footH;
      const h = Math.min(field.h - 60 * k, totalContentH);
      const top = Math.max(field.y + 40 * k, cy - h / 2);

      // Band background & glowing edges
      ctx.fillStyle = 'rgba(8, 11, 20, 0.95)';
      ctx.fillRect(0, top, screen.w, h);

      // Red alert top border with glow
      const topGlow = ctx.createLinearGradient(0, top - 12 * k, 0, top + 12 * k);
      topGlow.addColorStop(0, 'rgba(0,0,0,0)');
      topGlow.addColorStop(0.5, rgba(COLORS.danger, 0.28));
      topGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGlow;
      ctx.fillRect(0, top - 12 * k, screen.w, 24 * k);
      ctx.fillStyle = COLORS.danger;
      ctx.fillRect(0, top - 1, screen.w, 2);

      // Sodium bottom border with glow
      const botGlow = ctx.createLinearGradient(0, top + h - 12 * k, 0, top + h + 12 * k);
      botGlow.addColorStop(0, 'rgba(0,0,0,0)');
      botGlow.addColorStop(0.5, rgba(rightEdgeColor, 0.28));
      botGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = botGlow;
      ctx.fillRect(0, top + h - 12 * k, screen.w, 24 * k);
      ctx.fillStyle = rightEdgeColor;
      ctx.fillRect(0, top + h - 1, screen.w, 2);

      // Scanlines drifting across
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      const scanStep = Math.max(3, 3 * k);
      for (let y = top + 3 * k + ((age * 36) % scanStep); y < top + h - 3 * k; y += scanStep) {
        ctx.fillRect(0, y, screen.w, 1);
      }

      // Title with warning signs
      const unifiedTitle = `${round.finale ? t('mayhem.finale') : t('mayhem.round', { n: match.round })} · ${t('setup.group.anomalies')}`.toUpperCase();
      const titleY = top + 20 * k;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe3e6';
      ctx.font = `800 ${14 * k}px ${FONTS.display}`;
      setSpacing(ctx, 3 * k);
      this.fitDisplay(unifiedTitle, 14 * k, 3 * k, maxTextW - 40 * k);
      const titleW = ctx.measureText(unifiedTitle).width;
      ctx.fillText(unifiedTitle, cx, titleY);
      setSpacing(ctx, 0);

      ctx.globalAlpha = alpha * (0.45 + 0.55 * pulse);
      this.warningSign(cx - titleW / 2 - 12 * k, titleY, 6.5 * k);
      this.warningSign(cx + titleW / 2 + 12 * k, titleY, 6.5 * k);
      ctx.globalAlpha = alpha;

      // Anomalies (centered icon + name, centered hint)
      let curY = titleY + 18 * k;
      const aStagger = Math.min(0.15, 0.5 / Math.max(1, aCount));
      anomalies.forEach((anomaly, i) => {
        const at = 0.3 + i * aStagger;
        if (age < at) return;
        const name = t(`anomaly.${anomaly}`).toUpperCase();
        const typed = Math.min(name.length, Math.floor((age - at) * 38));
        const color = ANOMALY_COLORS[anomaly];
        const itemY = curY + 10 * k;

        ctx.font = `800 ${aNameSize}px ${FONTS.display}`;
        setSpacing(ctx, 1.8 * k);
        const nameW = ctx.measureText(name.slice(0, typed) + (typed < name.length ? '▌' : '')).width;
        const symbolR = (aCount <= 2 ? 8 : 6.5) * k;
        const iconGap = 8 * k;
        const totalW = symbolR * 2 + iconGap + nameW;
        const startX = cx - totalW / 2;
        const iconX = startX + symbolR;
        const textX = startX + symbolR * 2 + iconGap;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.6 * k;
        drawAnomalySymbol(ctx, anomaly, iconX, itemY, symbolR);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.slice(0, typed) + (typed < name.length ? '▌' : ''), textX, itemY);
        setSpacing(ctx, 0);

        if (typed >= name.length) {
          ctx.fillStyle = '#c8d2e8';
          ctx.font = `400 ${aHintSize}px ${FONTS.mono}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          aHints[i].forEach((line, lineIdx) => {
            ctx.fillText(line, cx, itemY + (aCount <= 2 ? 14 : 10) * k + lineIdx * aHintLineH);
          });
        }
        curY += aRowH;
      });

      // Subtle horizontal divider
      const divW = Math.min(maxTextW, 300 * k);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(cx - divW / 2, curY + 2 * k, divW, 1);
      curY += 12 * k;

      // Mayhem Twists (centered)
      const stopAt = (i: number) => landed - 0.2 * (tCount - 1 - i);
      if (!twists.length) {
        ctx.fillStyle = COLORS.bone;
        ctx.font = `800 ${22 * k}px ${FONTS.display}`;
        setSpacing(ctx, 3 * k);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t('mayhem.quiet'), cx, curY + 12 * k);
        setSpacing(ctx, 0);
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `400 ${tInfoSize}px ${FONTS.mono}`;
        ctx.textBaseline = 'top';
        ctx.fillText(t('mayhem.quietInfo'), cx, curY + 24 * k);
      } else {
        twists.forEach((twist, i) => {
          const itemY = curY + 12 * k;
          const stop = stopAt(i);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (age < stop) {
            const progress = age / stop;
            const face = Math.floor(age * 18 * (1 - progress * 0.65)) + i * 5;
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillStyle = COLORS.bone;
            const spinning = t(`mayhem.twist.${TWIST_IDS[face % TWIST_IDS.length]}`);
            this.fitDisplay(spinning, tNameSize, 2 * k, maxTextW);
            ctx.fillText(spinning, cx, itemY);
            setSpacing(ctx, 0);
            ctx.globalAlpha = alpha;
          } else {
            const since = age - stop;
            const pop = since < 0.14 ? 1.25 - (since / 0.14) * 0.25 : 1;
            ctx.fillStyle = COLORS.sodium;
            this.fitDisplay(twistName(twist), tNameSize * pop, 2 * k, maxTextW);
            ctx.fillText(twistName(twist), cx, itemY);
            setSpacing(ctx, 0);

            ctx.fillStyle = COLORS.boneDim;
            ctx.font = `400 ${tInfoSize}px ${FONTS.mono}`;
            ctx.textBaseline = 'top';
            tInfoLines[i].forEach((line, lineIdx) => {
              ctx.fillText(line, cx, itemY + (twists.length <= 2 ? 14 : 10) * k + lineIdx * (tInfoSize + 3 * k));
            });
          }
          curY += tRowH;
        });
      }

      // Jackpot banner (centered)
      if (round.jackpot && age > landed + 0.1) {
        const jPulse = 0.75 + 0.25 * Math.sin(age * 9);
        const jY = curY + 8 * k;
        ctx.globalAlpha = alpha * jPulse;
        ctx.fillStyle = COLORS.danger;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const jackpotLabel = t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR });
        this.fitDisplay(jackpotLabel, 18 * k, 2 * k, maxTextW);
        ctx.fillText(jackpotLabel, cx, jY);
        setSpacing(ctx, 0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `400 ${10.5 * k}px ${FONTS.mono}`;
        ctx.textBaseline = 'top';
        ctx.fillText(t('mayhem.jackpotInfo'), cx, jY + 12 * k);
      }

      // Footer (centered)
      if (age > landed) {
        ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(age * 4));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.boneDim;
        ctx.font = `700 ${11 * k}px ${FONTS.body}`;
        setSpacing(ctx, 2 * k);
        ctx.fillText(t(match.canAdvance ? 'mayhem.skip' : 'hud.waitingHost').toUpperCase(), cx, top + h - 16 * k);
        setSpacing(ctx, 0);
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
  }

  /** Classic two-player layout: big blocks in the top corners, as in the original. */
  private drawDuelBlock(match: Match, p: PlayerState, align: 'left' | 'right', cardMarks: Mark[][]): void {
    const { ctx, k, field } = this;
    const x = align === 'left' ? field.x + 24 * k : field.x + field.w - 24 * k;
    const y = field.y + 22 * k + this.drop;
    const active = (match.phase === 'aiming' || match.phase === 'flying') && match.focus === p.id;
    ctx.globalAlpha = active || match.phase === 'roundOver' || match.phase === 'gameOver' ? 1 : 0.55;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (active) {
      ctx.fillStyle = p.color;
      ctx.fillRect(align === 'left' ? x - 12 * k : x + 9 * k, y + 1 * k, 3 * k, 76 * k);
    }
    ctx.fillStyle = p.color;
    ctx.font = `700 ${11.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 2.2 * k);
    const label = nameLabel(p).toUpperCase();
    ctx.fillText(label, x, y);
    if (p.avatar) {
      // An online player's symbol follows the name, on the inside of the block.
      const width = ctx.measureText(label).width;
      drawAvatar(ctx, p.avatar, align === 'left' ? x + width + 16 * k : x - width - 16 * k, y + 7 * k, 17 * k, p.color);
    }
    setSpacing(ctx, 0);
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${30 * k}px ${FONTS.mono}`;
    ctx.fillText(String(p.score), x, y + 16 * k);
    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.boneDim;
    // Hidden aim keeps the opponent's numbers (and gauge) off the board while they are aiming.
    const hidden = match.phase === 'aiming' && !match.aimVisible(p.id);
    const angleText = hidden ? '—'.padStart(6, ' ') : fmt(p.angle, 2).padStart(6, ' ');
    const powerText = hidden ? '—'.padStart(6, ' ') : fmt(p.power, 2).padStart(6, ' ');
    ctx.fillText(`${pad(t('hud.angle'))} ${angleText}${hidden ? '' : '°'}`, x, y + 52 * k);
    ctx.fillText(`${pad(t('hud.power'))} ${powerText}${!hidden && match.settings.fixedPower ? t('hud.fixedSuffix') : ''}`, x, y + 68 * k);
    if (!hidden) this.drawGauge(align === 'left' ? x : x - 128 * k, y + 86 * k, 128 * k, p, align === 'right', match.settings.maxPower);
    ctx.globalAlpha = 1;
    if (match.powerUps) this.drawPowerUpSlot(p, x, y + 104 * k, align, match.placing && match.focus === p.id);
    // The marks a duel has (a bounty on the leader, revenge, domination, a comeback, and on your own side first blood and an opener) hang under the block.
    if (match.phase === 'aiming' && p.alive) {
      const width = 128 * k;
      const marks = cardMarks[p.id] ?? [];
      if (marks.length) this.drawMarkRow(marks, p.id === match.markViewer, align === 'left' ? x : x - width, align === 'left' ? x + width : x, y + (match.powerUps ? 138 : 112) * k, 6 * k, 16 * k, 11 * k, align === 'right');
    }
  }

  /**
   * Power-ups: the one a ship holds and the key that uses it, on one line as wide as the gauge
   * above (or as the card it sits under, in the scoreboard). No state words: an armed power-up shows its ring on
   * the ship instead.
   */
  private drawPowerUpSlot(p: PlayerState, x: number, y: number, align: 'left' | 'right', choosing: boolean, width = 128 * this.k): void {
    const { ctx, k } = this;
    const w = width;
    const h = 22 * k;
    const left = align === 'left' ? x : x - w;
    const held = p.powerUp;
    const color = held ? POWER_UP_COLORS[held] : COLORS.line;
    // A splitter is used with fire, a shield needs no key; the rest with P.
    const key = held === 'splitter' ? 'SPACE' : held === 'shield' ? null : held ? 'P' : null;
    const cy = y + h / 2;

    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillStyle = 'rgba(7, 14, 32, 0.6)';
    ctx.fillRect(left, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(left, y, 2 * k, h);

    // Symbol and name in the power-up's colour; nothing held shows a dim dash and the slot's name.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (held) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.6 * k;
      ctx.lineCap = 'round';
      drawPowerUpSymbol(ctx, held, left + 13 * k, cy, 5.5 * k);
    } else {
      ctx.fillStyle = COLORS.line;
      ctx.font = `400 ${12 * k}px ${FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.fillText('—', left + 13 * k, cy);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = held ? color : COLORS.boneDim;
    ctx.font = `700 ${10 * k}px ${FONTS.body}`;
    const name = held ? t(`powerup.${held}`).toUpperCase() : t('hud.powerUp.title').toUpperCase();
    ctx.fillText(fitText(ctx, name, w - 24 * k - 42 * k), left + 24 * k, cy + 0.5 * k);

    // The key that uses it, at the right edge.
    if (key) {
      const capW = (key === 'SPACE' ? 36 : 16) * k;
      const capH = 13 * k;
      const capX = left + w - capW - 5 * k;
      const capY = cy - capH / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * k;
      ctx.strokeRect(capX, capY, capW, capH);
      // An armed preview, piercing or plasma round has its key filled in: it is on.
      const on = p.armed && (held === 'preview' || held === 'piercing' || held === 'plasma');
      if (on) {
        ctx.fillStyle = color;
        ctx.fillRect(capX, capY, capW, capH);
      }
      ctx.fillStyle = on ? COLORS.plate : color;
      ctx.font = `700 ${7.5 * k}px ${FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.fillText(key, capX + capW / 2, cy + 0.5 * k);
      // Choosing a placement spot: fire places it, so its key joins the strip.
      if (choosing) {
        const jumpX = capX - capW - 4 * k;
        ctx.strokeRect(jumpX, capY, capW, capH);
        ctx.fillText('↵', jumpX + capW / 2, cy + 0.5 * k);
      }
    }
    ctx.restore();
  }

  /**
   * Three to six players: a row of chips under the round label. In team mode the chips are
   * grouped by team, each group under a header with the team's name and total.
   */
  private drawScoreboard(match: Match, marks: Mark[][]): void {
    const { ctx, k, field } = this;
    const players = match.teamMode ? [...match.players].sort((a, b) => a.team! - b.team! || a.seat - b.seat) : match.players;
    const n = players.length;
    const { w, gap, groupGap, groups } = this.cardLayout(match);
    const row = this.markRowHeight(match) * k;
    const h = 40 * k + row;
    // On a phone the first team heading would sit under the pause button's lower edge.
    const y = field.y + (match.teamMode ? (this.portrait ? 74 : 66) : 50) * k;
    const total = w * n + gap * (n - groups) + groupGap * (groups - 1);
    let x = field.x + (field.w - total) / 2;
    const planning = match.phase === 'aiming';
    // What a kill of each ship pays beyond its points, for the person at the screen; the card that pays most gets an outline.
    const viewer = match.markViewer;
    const payout = (id: number) => (id === viewer ? 0 : killPayout(marks[id] ?? []));
    const best = Math.max(0, ...players.map((p) => payout(p.id)));
    const standout = best >= MARK_STANDOUT && players.filter((p) => payout(p.id) === best).length === 1 ? players.find((p) => payout(p.id) === best)!.id : -1;

    players.forEach((p, i) => {
      const firstOfTeam = match.teamMode && (i === 0 || players[i - 1].team !== p.team);
      if (firstOfTeam) {
        if (i > 0) x += groupGap - gap;
        const team = match.teamRanking().find((r) => r.team === p.team)!;
        const width = w * team.members.length + gap * (team.members.length - 1);
        ctx.fillStyle = teamColor(p.team!);
        ctx.fillRect(x, y - 5 * k, width, 1.5 * k);
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.font = `800 ${15 * k}px ${FONTS.display}`;
        setSpacing(ctx, 2 * k);
        ctx.fillText(teamName(p.team!).toUpperCase(), x, y - 7 * k);
        setSpacing(ctx, 0);
        ctx.textAlign = 'right';
        ctx.font = `700 ${12 * k}px ${FONTS.mono}`;
        ctx.fillText(String(team.score), x + width, y - 8 * k);
      }

      // Everybody still aiming counts as active when all aim at once.
      const active = planning && (match.simultaneous ? match.canAim(p.id) : match.current === p.id);
      // Shot down, or dropped out for now: the card steps back.
      ctx.globalAlpha = p.alive && !p.away ? 1 : 0.38;
      ctx.fillStyle = rgba(COLORS.plate, 0.62);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, 3 * k, h);
      if (active) ctx.fillRect(x, y + h - 2 * k, w, 2 * k);

      // An online player's symbol leads the card, in the player's colour; the name and score sit beside it, above any mark row.
      const textX = p.avatar ? x + 26 * k : x + 10 * k;
      if (p.avatar) drawAvatar(ctx, p.avatar, x + 17 * k, y + (h - row) / 2, 16 * k, p.color);
      const status = p.left ? [t('hud.left'), COLORS.boneDim] : p.away ? [t('hud.away'), COLORS.boneDim] : !p.alive ? ['✕', COLORS.boneDim] : active ? [t('hud.aiming'), p.color] : planning && p.locked ? [t('hud.ready'), COLORS.boneDim] : null;
      const name = p.name.toUpperCase();
      const room = w - (textX - x) - 4 * k;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
      const statusWidth = status ? ctx.measureText(status[0]).width + 8 * k : 0;
      ctx.font = `700 ${10 * k}px ${FONTS.body}`;
      setSpacing(ctx, 1.6 * k);
      // Six cards across a phone are narrow: when the name and the status do not both fit, the status becomes a dot and the name shrinks to the room.
      const roomy = ctx.measureText(name).width + statusWidth <= room;
      if (!roomy) {
        ctx.font = `700 ${9 * k}px ${FONTS.body}`;
        setSpacing(ctx, 0.6 * k);
      }
      ctx.fillText(roomy ? name : fitText(ctx, name, room - (status ? 8 * k : 0)), textX, y + 6 * k);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.bone;
      ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
      ctx.fillText(String(p.score), textX, y + 19 * k);
      if (planning && p.alive && !p.away) this.drawCardMarks(marks[p.id] ?? [], p.id === viewer, x, y, w, h, row > 0 ? null : textX + ctx.measureText(String(p.score)).width);
      if (p.id === standout) {
        ctx.strokeStyle = rgba(MARK_COLORS[topMark(marks[p.id]).kind], 0.8);
        ctx.lineWidth = 1.5 * k;
        ctx.strokeRect(x + 0.75 * k, y + 0.75 * k, w - 1.5 * k, h - 1.5 * k);
      }

      if (status) {
        ctx.fillStyle = status[1];
        if (roomy) {
          ctx.textAlign = 'right';
          ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
          ctx.fillText(status[0], x + w - 8 * k, y + 7 * k);
        } else {
          ctx.beginPath();
          ctx.arc(x + w - 6 * k, y + 9 * k, 2.4 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // The power-up area under the card: what the ship holds, and its key. Dead ships keep theirs out of sight.
      if (match.powerUps && p.alive) this.drawPowerUpSlot(p, x, y + h + 4 * k, 'left', match.placing && match.focus === p.id, w);
      ctx.globalAlpha = 1;
      x += w + gap;
    });
  }

  /** How wide the scoreboard's cards are (as wide as the field allows, at most 172) and the gaps between them; teams get a wider gap between groups. */
  private cardLayout(match: Match): { w: number; gap: number; groupGap: number; groups: number } {
    const { k, field } = this;
    const n = match.players.length;
    const gap = 8 * k;
    const groups = match.teamMode ? new Set(match.players.map((p) => p.team)).size : 1;
    const groupGap = match.teamMode ? 22 * k : gap;
    return { w: Math.min(172 * k, (field.w - 48 * k - gap * (n - groups) - groupGap * (groups - 1)) / n), gap, groupGap, groups };
  }

  /** The height (field units) the scoreboard's cards grow by when they are too narrow to hold their marks beside the score; the same for the whole round, so nothing below jumps. */
  private markRowHeight(match: Match): number {
    return match.paysKillBonuses && this.cardLayout(match).w < MARK_ROOM * this.k ? MARK_ROW : 0;
  }

  /**
   * The marks on a ship's card: the symbols (most valuable first) and, on the card of a target, what a kill of it pays on top of its points.
   * On your own card they are what any kill of yours pays now. Where the card is wide they sit along its bottom edge from the right, beside
   * the score (`scoreRight`, where the score ends); a narrow card has a row for them under the score (`scoreRight` null).
   */
  private drawCardMarks(marks: Mark[], own: boolean, x: number, y: number, w: number, h: number, scoreRight: number | null): void {
    if (!marks.length) return;
    const { ctx, k } = this;
    if (scoreRight === null) {
      this.drawMarkRow(marks, own, x + 5 * k, x + w - 5 * k, y + h - (MARK_ROW / 2 + 1) * k, 5 * k, 13 * k, 8.5 * k, false);
      return;
    }
    const r = 5.8 * k;
    const pitch = 15.5 * k;
    const cy = y + h - 10.5 * k;
    const right = x + w - 9 * k;
    const left = scoreRight + 6 * k;
    const sorted = byValue(marks);
    const fit = fitMarks(sorted.length, right - left, r, pitch);
    if (!fit) return;
    ctx.save();
    this.drawMarkSymbols(sorted.slice(0, fit), (i) => right - r - i * pitch, cy, r);
    // The sum of the extras of a kill: only on a target's card, and only where it fits beside the symbols.
    const total = own ? 0 : killPayout(marks);
    if (total > 0) {
      ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
      const text = `+${total}`;
      const edge = right - fit * pitch + (pitch - 2 * r) / 2;
      if (edge - ctx.measureText(text).width >= left) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = MARK_COLORS[topMark(marks).kind];
        ctx.fillText(text, edge - 2 * k, cy + 0.5 * k);
      }
    }
    ctx.restore();
  }

  /**
   * A row of marks between `from` and `to` at height `cy`: the symbols from one end (the left, or the right when `mirror`), most valuable
   * first, and at the other end the sum a kill pays on top (not on your own card), when there is room for it beside at least one symbol.
   */
  private drawMarkRow(marks: Mark[], own: boolean, from: number, to: number, cy: number, r: number, pitch: number, font: number, mirror: boolean): void {
    const { ctx, k } = this;
    const total = own ? 0 : killPayout(marks);
    const text = `+${total}`;
    ctx.save();
    ctx.font = `700 ${font}px ${FONTS.mono}`;
    const textWidth = ctx.measureText(text).width;
    const sorted = byValue(marks);
    // The sum is what says which ship to take: it keeps its place, and the symbols share what is left.
    const withTotal = total > 0 && fitMarks(sorted.length, to - from - textWidth - 4 * k, r, pitch) > 0;
    const fit = fitMarks(sorted.length, withTotal ? to - from - textWidth - 4 * k : to - from, r, pitch);
    this.drawMarkSymbols(sorted.slice(0, fit), (i) => (mirror ? to - r - i * pitch : from + r + i * pitch), cy, r);
    if (withTotal) {
      ctx.fillStyle = MARK_COLORS[topMark(marks).kind];
      ctx.textBaseline = 'middle';
      ctx.textAlign = mirror ? 'left' : 'right';
      ctx.fillText(text, mirror ? from : to, cy + 0.5 * k);
    }
    ctx.restore();
  }

  /** The symbols of `marks` in a line at height `cy`, the i-th centred at `x(i)`. */
  private drawMarkSymbols(marks: Mark[], x: (i: number) => number, cy: number, r: number): void {
    const { ctx, k } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.4 * k;
    marks.forEach((mark, i) => {
      ctx.strokeStyle = ctx.fillStyle = MARK_COLORS[mark.kind];
      drawMarkSymbol(ctx, mark.kind, x(i), cy, r);
    });
  }

  private drawKillFeed(match: Match): void {
    const { ctx, k, field } = this;
    const entries = match.killFeed.filter((r) => match.clock - r.at < 6).slice(-4);
    // Under the scoreboard's cards the power-up areas take a line, so the feed starts below them.
    let y = field.y + (match.teamMode ? 118 : 102) * k + this.markRowHeight(match) * k + (match.powerUps ? 30 * k : 0);
    ctx.textBaseline = 'top';
    ctx.font = `700 ${11.5 * k}px ${FONTS.mono}`;
    for (const r of entries) {
      const age = match.clock - r.at;
      ctx.globalAlpha = age > 5 ? 6 - age : 1;
      this.drawSegmentsRight(killSegments(match, r), field.x + field.w - 24 * k, y);
      y += 17 * k;
    }
    ctx.globalAlpha = 1;
  }

  private drawSegmentsRight(segments: Segment[], right: number, y: number): void {
    const { ctx } = this;
    let x = right - segments.reduce((s, [t]) => s + ctx.measureText(t).width, 0);
    ctx.textAlign = 'left';
    for (const [text, color] of segments) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  }

  /**
   * How far below the field's top (field units, before the duel's drop) the readout stays: clear of the duel blocks and the marks under them,
   * or of the cards and their mark row. Fixed for the match, so the card does not jump when marks come and go.
   */
  private readoutTop(match: Match): number {
    if (match.mode === 'classic' && match.players.length === 2) return match.paysKillBonuses ? (match.powerUps ? 172 : 146) : 130;
    return (match.teamMode ? 114 : 98) + this.markRowHeight(match);
  }

  /** Angle / power next to the aiming ship, plus the shot clock in Event Horizon. */
  private drawReadout(match: Match, p: PlayerState, at: { x: number; y: number }, dodge: boolean): void {
    const { ctx, k, field } = this;
    const towardsCentre = at.x < field.x + field.w / 2 ? 1 : -1;
    const w = 112 * k;
    const h = 44 * k;
    const top = this.readoutTop(match);
    // Where the card goes for each place it may stand: beside the ship towards the middle, beside it on the far side, above, below.
    const place = (slot: number): { x: number; y: number } => {
      const side = slot === 1 ? -towardsCentre : towardsCentre;
      let px = at.x + side * 40 * k - (side < 0 ? w : 0);
      let py = at.y - h / 2;
      if (slot >= 2) {
        px = at.x - w / 2;
        py = slot === 2 ? at.y - 40 * k - h : at.y + 40 * k;
      }
      px = Math.min(field.x + field.w - w - 6, Math.max(field.x + 6, px));
      py = Math.min(field.y + field.h - h - 30 * k, Math.max(field.y + top * k + this.drop, py));
      return { x: px, y: py };
    };
    // The aim is a line out of the ship: the card steps aside when it would sit on it, and stays there until that place is in the way too.
    // `at` is on screen, so the direction is too: a rotated field maps field (x, y) to screen (y, -x).
    const fieldDir = aimDirection(p.angle);
    const dir = this.rotated ? { x: fieldDir.y, y: -fieldDir.x } : fieldDir;
    const aimed = (slot: number): boolean => {
      const pos = place(slot);
      return rayHitsRect(at, dir, AIM_CLEAR * k, pos.x - 8 * k, pos.y - 8 * k, w + 16 * k, h + 16 * k);
    };
    let slot = this.readoutSlot.id === p.id ? this.readoutSlot.slot : 0;
    if (dodge && aimed(slot)) slot = [0, 1, 2, 3].find((s) => !aimed(s)) ?? slot;
    if (!dodge) slot = 0;
    const target = place(slot);
    // It glides to its new place rather than jumping, but starts from the right one when it was not on screen a moment ago.
    const fresh = this.readoutSlot.id !== p.id || this.time - this.readoutSlot.seen > 0.25;
    const dt = Math.max(0, Math.min(0.1, this.time - this.readoutSlot.seen));
    const glide = fresh ? 1 : Math.min(1, dt * 16);
    const x = fresh ? target.x : this.readoutSlot.x + (target.x - this.readoutSlot.x) * glide;
    const y = fresh ? target.y : this.readoutSlot.y + (target.y - this.readoutSlot.y) * glide;
    this.readoutSlot = { id: p.id, slot, x, y, seen: this.time };

    ctx.fillStyle = rgba(COLORS.plate, 0.78);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 2 * k, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `400 ${11 * k}px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(`${fmt(p.angle, 2)}°`, x + 9 * k, y + 7 * k);
    ctx.fillText(fmt(p.power, 2), x + 9 * k, y + 23 * k);
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${8.5 * k}px ${FONTS.body}`;
    ctx.textAlign = 'right';
    ctx.fillText(t('hud.angle'), x + w - 8 * k, y + 8 * k);
    ctx.fillText(t('hud.power'), x + w - 8 * k, y + 24 * k);
    this.drawGauge(x + 9 * k, y + h - 6 * k, w - 18 * k, p, false, match.settings.maxPower);

    const clock = match.shotClock;
    if (clock !== null) {
      ctx.textAlign = towardsCentre > 0 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${30 * k}px ${FONTS.display}`;
      ctx.fillStyle = clock < 4 ? COLORS.danger : COLORS.bone;
      ctx.fillText(String(Math.ceil(clock)), towardsCentre > 0 ? x + w + 10 * k : x - 10 * k, y + h / 2);
    }
  }

  private drawGauge(x: number, y: number, w: number, p: PlayerState, fromRight: boolean, cap: number): void {
    const { ctx, k } = this;
    ctx.fillStyle = rgba(COLORS.line, 0.35);
    ctx.fillRect(x, y, w, 2 * k);
    ctx.fillStyle = p.color;
    const fill = (p.power / AIM.MAX_POWER) * w;
    ctx.fillRect(fromRight ? x + w - fill : x, y, fill, 2 * k);
    if (cap < AIM.MAX_POWER) {
      // A tick where the power cap ends.
      const at = (cap / AIM.MAX_POWER) * w;
      ctx.fillStyle = rgba(COLORS.bone, 0.7);
      ctx.fillRect((fromRight ? x + w - at : x + at) - k / 2, y - 2 * k, k, 6 * k);
    }
  }

  // ————————————————————————————— Daily challenge —————————————————————————————

  private drawChallenge(match: ChallengeMatch, opts: DrawOptions): void {
    const { ctx, k, field } = this;
    // Reserve 60 px for the pause button: its 12 px inset, 36 px body, 6 px
    // touch-target inset, and a 6 px gap before the title.
    const left = Math.max(field.x + 24 * k, 60);
    const right = field.x + field.w - 24 * k;
    const top = field.y + 18 * k;
    const label = t('daily.hud.label', { n: match.challenge.number });
    const sector = `${t('daily.hud.sector')} ${match.round} / ${match.totalRounds}`;
    ctx.textBaseline = 'top';

    // Left: which challenge, which theme.
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.sodium;
    ctx.font = `800 ${22 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(label, left, top);
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${10.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    ctx.fillText(t(`daily.theme.${match.challenge.theme}`).toUpperCase(), left, top + 28 * k);

    // Centre: the sector, and the rules it plays by.
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.bone;
    const sectorFont = 24 * k;
    ctx.font = `800 ${sectorFont}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    let sectorWidth = ctx.measureText(sector).width;
    const sectorLeft = left + labelWidth + 8 * k;
    ctx.font = `700 ${10 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    const scoreLabelWidth = ctx.measureText(t('daily.hud.score')).width;
    const sectorRight = right - scoreLabelWidth - 8 * k;
    const sectorRoom = sectorRight - sectorLeft;
    let sectorScale = 1;
    if (sectorRoom > 0 && sectorWidth > sectorRoom) {
      sectorScale = Math.max(0.55, sectorRoom / sectorWidth);
      ctx.font = `800 ${sectorFont * sectorScale}px ${FONTS.display}`;
      setSpacing(ctx, 2 * k * sectorScale);
      sectorWidth = ctx.measureText(sector).width;
    }
    const centerMin = sectorLeft + sectorWidth / 2;
    const centerMax = sectorRight - sectorWidth / 2;
    const centerX = sectorRoom > 0
      ? Math.min(Math.max(field.x + field.w / 2, centerMin), Math.max(centerMin, centerMax))
      : field.x + field.w / 2;
    ctx.font = `800 ${sectorFont * sectorScale}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k * sectorScale);
    ctx.fillText(sector, centerX, top);
    setSpacing(ctx, 0);
    const chips = modifierChips(match);
    this.drawChips(chips.labels, field.x + field.w / 2, top + 34 * k, chips.colors, chips.glitching);

    // Right: points, targets left, shots left.
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${10 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    ctx.fillText(t('daily.hud.score'), right, top);
    setSpacing(ctx, 0);
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${34 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1 * k);
    ctx.fillText(fmtInt(match.total), right, top + 11 * k);
    setSpacing(ctx, 0);
    this.drawPipRow(t('daily.hud.targets'), right, top + 54 * k, match.targetsTotal, match.targetsLeft, 'diamond', COLORS.danger);
    this.drawPipRow(t('daily.hud.shots'), right, top + 72 * k, match.spec.shots, match.shotsLeft, 'dot', COLORS.bone);

    if (match.phase === 'aiming' && match.current >= 0) this.drawReadout(match, match.pilot, this.shipPos(match.current), opts.aimCardDodge);
    if (match.phase === 'roundOver' && match.summary) this.drawChallengeBanner(match);
    if (!match.revealing) this.drawHint(match, opts.touch);
    if (match.revealing && match.anomalyAlert && anomaliesOf(match.rules).length > 0) {
      this.drawAnomalyAlert(match);
    }
  }

  /** Small outlined tags centred on `cx`, e.g. "BOUNCE". */
  /**
   * How far a chip is torn apart right now, 0 to 1: each of the first `glitching` chips has a signal of its own that breaks
   * for a few tenths of a second every few seconds, at times that differ from chip to chip. Nothing for people who ask
   * for less motion.
   */
  private glitchOf(i: number): number {
    if (this.calm) return 0;
    const period = 3.4 + i * 0.9;
    const phase = ((this.time + i * 1.3) % period) / period;
    const window = 0.13;
    if (phase > window) return 0;
    // Strongest at the start, dying out, with a stutter in it.
    const fade = 1 - phase / window;
    return fade * (Math.sin(this.time * 61 + i) > -0.4 ? 1 : 0.35);
  }

  private drawChips(labels: string[], cx: number, y: number, colors: string[] = [], glitching = 0): void {
    if (!labels.length) return;
    const { ctx, k } = this;
    ctx.font = `700 ${9.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.4 * k);
    const padX = 7 * k;
    const gap = 6 * k;
    const rowGap = 5 * k;
    const widths = labels.map((l) => ctx.measureText(l.toUpperCase()).width + padX * 2);
    // Chips that don't fit side by side in the field wrap onto further rows, each row centred.
    const room = this.field.w - 16 * k;
    const rows: number[][] = [[]];
    let used = 0;
    widths.forEach((w, i) => {
      const row = rows[rows.length - 1];
      if (row.length && used + gap + w > room) {
        rows.push([i]);
        used = w;
      } else {
        used += (row.length ? gap : 0) + w;
        row.push(i);
      }
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    rows.forEach((row, r) => {
      const top = y + r * (17 * k + rowGap);
      let x = cx - (row.reduce((sum, i) => sum + widths[i], 0) + gap * (row.length - 1)) / 2;
      for (const i of row) {
        this.drawChip(labels[i], x, top, widths[i], padX, colors[i] ?? COLORS.sodium, i < glitching ? this.glitchOf(i) : 0, i);
        x += widths[i] + gap;
      }
    });
    setSpacing(ctx, 0);
    ctx.textBaseline = 'top';
  }

  private drawChip(label: string, x: number, y: number, width: number, padX: number, color: string, glitch: number, i: number): void {
    const { ctx, k } = this;
    if (glitch > 0) {
      // Torn: the chip is drawn three times, a cyan and a red copy thrown apart sideways, and the real one shaken a little.
      const shift = glitch * 6.5 * k;
      const shake = glitch * 3 * k * Math.sin(this.time * 97 + i * 5);
      const rise = glitch * 2 * k * Math.cos(this.time * 83 + i);
      for (const [tint, dx] of [['#3ff0ff', -shift], [COLORS.danger, shift]] as const) {
        ctx.globalAlpha = 0.65 * glitch;
        ctx.strokeStyle = tint;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.roundRect(x + dx + 0.5, y + 0.5, width, 17 * k, 3 * k);
        ctx.stroke();
        ctx.fillText(label.toUpperCase(), x + dx + padX, y + 9.5 * k);
      }
      ctx.globalAlpha = 1;
      x += shake;
      y += rise;
    }
    ctx.strokeStyle = rgba(color, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, width, 17 * k, 3 * k);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label.toUpperCase(), x + padX, y + 9.5 * k);
  }

  /** "TARGETS ◆ ◆ ◇": `left` of `total` pips are filled, the rest hollow. Right-aligned at `right`. */
  private drawPipRow(label: string, right: number, y: number, total: number, left: number, shape: 'diamond' | 'dot', color: string): void {
    const { ctx, k } = this;
    const size = 5.5 * k;
    const step = size * 2 + 5 * k;
    for (let i = 0; i < total; i++) {
      // Spent pips empty from the right, so the filled ones stay on the left.
      const cx = right - size - (total - 1 - i) * step;
      const cy = y + 6 * k;
      const filled = i < left;
      ctx.beginPath();
      if (shape === 'diamond') {
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx + size, cy);
        ctx.lineTo(cx, cy + size);
        ctx.lineTo(cx - size, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, size * 0.85, 0, Math.PI * 2);
      }
      if (filled) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba(COLORS.boneDim, 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${9.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.6 * k);
    ctx.fillText(label, right - total * step - 4 * k, y + 6.5 * k);
    setSpacing(ctx, 0);
    ctx.textBaseline = 'top';
  }

  /**
   * What takes the screen over for a moment: the whole canvas dims (`dim`), HUD and field alike, and a band runs
   * edge to edge at `top`, `h` tall, with a lit line at each edge in `edge` and a soft glow spilling out of it.
   * Draw it with the global alpha of the moment's fade.
   */
  private takeOver(top: number, h: number, edge: string, dim: number, band: number): void {
    const { ctx, screen } = this;
    ctx.fillStyle = rgba(COLORS.plate, dim);
    ctx.fillRect(0, 0, screen.w, screen.h);
    ctx.fillStyle = rgba(COLORS.plate, band);
    ctx.fillRect(0, top, screen.w, h);
    for (const y of [top, top + h]) {
      const glow = ctx.createLinearGradient(0, y - 14, 0, y + 14);
      glow.addColorStop(0, rgba(edge, 0));
      glow.addColorStop(0.5, rgba(edge, 0.22));
      glow.addColorStop(1, rgba(edge, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, y - 14, screen.w, 28);
    }
    ctx.fillStyle = rgba(edge, 0.85);
    ctx.fillRect(0, top, screen.w, 1);
    ctx.fillRect(0, top + h - 1, screen.w, 1);
  }

  /**
   * Sets the display font at `size` with `spacing` between the letters — smaller, with the spacing, when `text`
   * would be wider than `maxWidth`: a narrow screen must not cut a headline off.
   */
  private fitDisplay(text: string, size: number, spacing: number, maxWidth: number): void {
    const { ctx } = this;
    ctx.font = `800 ${size}px ${FONTS.display}`;
    setSpacing(ctx, spacing);
    const width = ctx.measureText(text).width;
    if (width <= maxWidth) return;
    const shrink = maxWidth / width;
    ctx.font = `800 ${size * shrink}px ${FONTS.display}`;
    setSpacing(ctx, spacing * shrink);
  }

  private drawChallengeBanner(match: ChallengeMatch): void {
    const { ctx, k, field } = this;
    const s = match.summary!;
    const res = match.results[match.results.length - 1];
    const fade = Math.min(1, Math.max(0, (match.phaseTime - 0.35) / 0.4));
    if (fade <= 0 || !res) return;
    const color = res.cleared ? COLORS.sodium : COLORS.danger;
    const title = t(`title.${s.title}`);
    const cx = field.x + field.w / 2;
    const cy = field.y + field.h / 2;
    const h = 150 * k;

    ctx.globalAlpha = fade;
    this.takeOver(cy - h / 2, h, color, 0.45, 0.85);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    this.fitDisplay(title, (title.length > 16 ? 58 : title.length > 10 ? 70 : 84) * k, 6 * k, field.w - 32 * k);
    ctx.fillText(title, cx + 3 * k, cy + 12 * k);
    setSpacing(ctx, 0);

    const points = `${res.points >= 0 ? '+' : '−'}${fmtInt(Math.abs(res.points))}`;
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    ctx.fillText(points, cx, cy + 42 * k);

    const tricks = [...new Set(res.shots.flatMap((x) => x.combo))].map((c) => styleLabel(c));
    const parts = [t('daily.hud.shotsUsed', { used: res.shots.length, budget: res.budget })];
    if (res.bonus) parts.push(t('daily.hud.clearBonus', { n: res.bonus }));
    if (tricks.length) parts.push(tricks.join(' · '));
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    ctx.fillText(fitText(ctx, parts.join('  ·  '), field.w - 32 * k), cx, cy + 62 * k);
    ctx.globalAlpha = 1;
  }

  // ————————————————————————————— Centre —————————————————————————————

  /** "SALVE!" — punches in, then fades. */
  private drawNotice(match: Match): void {
    const n = match.notice;
    if (!n) return;
    const { ctx, k, field } = this;
    const age = match.clock - n.at;
    const pop = age < 0.18 ? 1.5 - (age / 0.18) * 0.5 : 1;
    ctx.globalAlpha = age > 0.9 ? Math.max(0, 1 - (age - 0.9) / 0.5) : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.fitDisplay(n.text, 110 * k * pop, 8 * k, field.w - 24 * k);
    ctx.lineWidth = 6 * k;
    ctx.strokeStyle = rgba(COLORS.plate, 0.8);
    ctx.strokeText(n.text, field.x + field.w / 2, field.y + field.h / 2);
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, field.x + field.w / 2, field.y + field.h / 2);
    setSpacing(ctx, 0);
    ctx.globalAlpha = 1;
  }

  private drawTurnToast(p: PlayerState): void {
    const { ctx, k, field } = this;
    const age = this.time - this.turnAt;
    ctx.globalAlpha = age > 1.2 ? (1.6 - age) / 0.4 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = t('hud.turn', { name: p.name.toUpperCase() });
    this.fitDisplay(text, 34 * k, 3 * k, field.w - 24 * k);
    ctx.fillStyle = p.color;
    ctx.fillText(text, field.x + field.w / 2, field.y + field.h - 64 * k);
    setSpacing(ctx, 0);
    ctx.globalAlpha = 1;
  }

  /** The round's awards as a row of cards under the banner: longest shot, fastest kill, most swing-bys, … */
  private drawScorecard(match: Match): void {
    const { ctx, k, field } = this;
    const list = awards(match.roundStats);
    const fade = Math.min(1, Math.max(0, (match.phaseTime - 0.9) / 0.5));
    if (!list.length || fade <= 0) return;

    const gap = 10 * k;
    const cardH = 68 * k;
    // On a tall phone, use two rows before the cards become too narrow to read.
    // Keep the space below clear when the oracle also has a round summary there.
    const oracleSummary = (match.betOracle.roundResult?.round === match.round || match.betOracle.roundRanking().length > 0);
    const narrow = field.w < 650 * k && field.h >= 650 * k && !oracleSummary;
    const perRow = list.length > 5 || (narrow && list.length > 3) ? Math.ceil(list.length / 2) : list.length;
    const cardW = Math.min(196 * k, (field.w - 48 * k - gap * (perRow - 1)) / perRow);
    const y = field.y + field.h / 2 + 75 * k + 30 * k;
    const lit = spotlight(match);

    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${10.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 2.4 * k);
    ctx.fillText(t('scorecard.round').toUpperCase(), field.x + field.w / 2 + 1.2 * k, y - 11 * k);
    setSpacing(ctx, 0);

    list.forEach((award, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, list.length - row * perRow);
      const x = field.x + (field.w - (inRow * cardW + gap * (inRow - 1))) / 2 + (i - row * perRow) * (cardW + gap);
      const top = y + row * (cardH + gap);
      const who = awardWho(match, award);
      ctx.fillStyle = rgba(COLORS.plate, 0.8);
      ctx.fillRect(x, top, cardW, cardH);
      ctx.fillStyle = who.color;
      ctx.fillRect(x, top, 3 * k, cardH);
      if (lit?.index === i) {
        // The card whose shot is lit up on the field.
        ctx.strokeStyle = rgba(COLORS.bone, 0.85);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x + 0.5, top + 0.5, cardW - 1, cardH - 1);
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = `700 ${9 * k}px ${FONTS.body}`;
      setSpacing(ctx, 1.4 * k);
      ctx.fillText(fitText(ctx, awardLabel(award.kind).toUpperCase(), cardW - 18 * k), x + 11 * k, top + 8 * k);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.bone;
      ctx.font = `700 ${20 * k}px ${FONTS.mono}`;
      // Keep the complete value and unit within its card, even for large records.
      ctx.fillText(awardValue(award), x + 11 * k, top + 22 * k, Math.max(1, cardW - 18 * k));
      ctx.fillStyle = who.color;
      ctx.font = `700 ${11.5 * k}px ${FONTS.body}`;
      ctx.fillText(fitText(ctx, who.name, cardW - 18 * k), x + 11 * k, top + 48 * k);
    });
    ctx.globalAlpha = 1;
  }

  private drawBanner(match: Match, duel: boolean): void {
    const { ctx, k, field } = this;
    const s = match.summary!;
    const fade = Math.min(1, Math.max(0, (match.phaseTime - 0.35) / 0.4));
    if (fade <= 0) return;
    const survivor = s.survivor !== null ? match.players[s.survivor] : null;
    const color = s.team !== null ? teamColor(s.team) : survivor?.color ?? dangerColor();
    const title = s.title === 'teamWin' ? t('title.teamWin', { team: teamName(s.team!).toUpperCase() }) : t(`title.${s.title}`);
    const cx = field.x + field.w / 2;
    const cy = field.y + field.h / 2;
    const h = 150 * k;

    ctx.globalAlpha = fade;
    this.takeOver(cy - h / 2, h, color, 0.45, 0.85);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    this.fitDisplay(title, (title.length > 10 ? 70 : 84) * k, 6 * k, field.w - 32 * k);
    ctx.fillText(title, cx + 3 * k, cy + 12 * k);
    setSpacing(ctx, 0);

    const kill = s.lastKill;
    let line1: string;
    let line2 = '';
    if (duel && kill && !kill.self && kill.killer !== null) {
      line1 = `${match.players[kill.killer].name}  +${kill.points}`;
      line2 = kill.collateral ? t('hud.collateral') : t('hud.shotPower', { n: kill.shots, power: fmt(kill.power, 2) });
    } else if (s.team !== null) {
      line1 = `${t('hud.teamWinsRound', { team: teamName(s.team) })}${s.bonus ? `  ·  ${t('hud.perMember', { n: s.bonus })}` : ''}`;
      if (kill) line2 = killSegments(match, kill).map(([text]) => text).join('');
    } else {
      line1 = survivor ? `${t('hud.winsRound', { name: survivor.name })}${s.bonus ? `  +${s.bonus}` : ''}` : match instanceof ClassicMatch && match.decidedBySuddenDeath && match.alive.length ? t('hud.noWinner') : t('hud.noSurvivor');
      if (kill) line2 = killSegments(match, kill).map(([text]) => text).join('');
    }
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    ctx.fillText(fitText(ctx, line1, field.w - 32 * k), cx, cy + 42 * k);
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    ctx.fillText(fitText(ctx, line2, field.w - 32 * k), cx, cy + 62 * k);
    ctx.globalAlpha = 1;
  }

  // ————————————————————————————— Killcam —————————————————————————————

  private drawKillcam(match: Match, info: NonNullable<Match['killcamInfo']>, opts: DrawOptions): void {
    const { recording, slow } = info;
    const record = info.clip.record;
    const { ctx, k, field } = this;
    const bar = Math.max(34 * k, field.h * 0.09);
    // Touch controls occupy the top row. Put both killcam labels below them.
    const topBar = opts.touch ? Math.max(bar, 104 * k) : bar;
    const headerY = field.y + (opts.touch ? topBar - 17 * k : topBar / 2);
    ctx.fillStyle = rgba(COLORS.plate, 0.88);
    ctx.fillRect(field.x, field.y, field.w, topBar);
    ctx.fillRect(field.x, field.y + field.h - bar, field.w, bar);

    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    ctx.fillStyle = rgba(COLORS.danger, pulse);
    ctx.beginPath();
    ctx.arc(field.x + 26 * k, headerY, 6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${24 * k}px ${FONTS.display}`;
    setSpacing(ctx, 3 * k);
    ctx.fillText(recording ? t('hud.recClip') : t('hud.killcam'), field.x + 40 * k, headerY + 1);
    setSpacing(ctx, 0);

    if (slow) {
      ctx.textAlign = 'right';
      ctx.font = `700 ${14 * k}px ${FONTS.mono}`;
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(`${fmt(0.2, 1)}×`, field.x + field.w - 24 * k, headerY);
    }

    ctx.font = `700 ${13 * k}px ${FONTS.mono}`;
    const segments = killSegments(match, record);
    const width = segments.reduce((s, [t]) => s + ctx.measureText(t).width, 0);
    this.drawSegmentsRight(segments, field.x + field.w / 2 + width / 2, field.y + field.h - bar / 2 - 6 * k);

    if (!recording && !opts.touch) {
      // Online, skipping is a vote: show how many are in favour.
      const skip = match.viewer !== null && info ? `${t('hud.skip')} ${info.votes}/${info.needed}` : t('hud.skip');
      this.drawKeyRow([[t('common.space'), skip], ['C', t('hud.saveClip')]], field.x + field.w / 2, field.y + field.h - bar - 18 * k, this.k * 0.9);
    }
  }

  private drawRec(): void {
    const { ctx, k, field } = this;
    ctx.fillStyle = rgba(COLORS.danger, 0.55 + 0.45 * Math.sin(this.time * 6));
    ctx.beginPath();
    ctx.arc(field.x + field.w - 60 * k, field.y + 30 * k, 5 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${12 * k}px ${FONTS.mono}`;
    ctx.fillText('REC', field.x + field.w - 50 * k, field.y + 30 * k);
  }

  // ————————————————————————————— Hints —————————————————————————————

  private drawHint(match: Match, touch: boolean): void {
    const { k, field } = this;
    const maxWidth = field.w - 48 * k;
    // Switching to a phone-sized window, the field can be narrower than the margins for a frame: there is no room for a hint.
    if (maxWidth <= 0) return;
    let items: KeyItem[] = [];
    if (match.localCanAim) {
      if (touch) {
        items = [['', match.salvo ? t('hud.touch.horizon') : t('hud.touch.classic')]];
      } else {
        const power: KeyItem = ['↑ ↓', match.settings.fixedPower ? t('hud.powerFixed') : t('hud.powerLabel')];
        const commit: KeyItem = ['Enter', match.salvo ? t('common.ready') : t('common.fire')];
        items = [['← →', t('hud.rotate')], power, commit, [`Shift · Alt · ${t('common.ctrl')}`, t('hud.stepSize')], ['Esc', t('hud.menu')]];
        if (this.measureKeyRow(items, k) > maxWidth) items = [['← →', t('hud.rotate')], power, commit];
      }
    } else if (match.phase === 'aiming') {
      const thinker = match.current >= 0 ? match.players[match.current] : null;
      // Online, the others are people: say whom we are waiting for.
      if (match.viewer !== null && match.simultaneous) items = [['', t('hud.waitingOthers')]];
      else if (match.viewer !== null && thinker && !thinker.cpu) items = [['', t('hud.waitingFor', { name: thinker.name })]];
      else items = [['', thinker?.cpu ? t('hud.thinking', { name: thinker.name }) : t('hud.cpusAiming')]];
    } else if (match.phase === 'orbit' && !(match instanceof SolarMatch && match.blasting)) {
      items = [['', t('hud.orbit')]];
    } else if (match.phase === 'collapse') {
      items = [['', t('hud.collapse')]];
    } else if (match.phase === 'roundOver' && match.phaseTime > 0.6) {
      const next = match.isLastRound ? t('hud.finalStandings') : match instanceof ChallengeMatch ? t('daily.hud.nextSector') : t('hud.nextRound');
      items = [match.canAdvance ? [touch ? '' : t('common.space'), next] : ['', t('hud.waitingHost')]];
      if (match.canSaveClip && !touch) items.push(['C', t('hud.saveKillcam')]);
    }
    if (!items.length) return;
    const width = this.measureKeyRow(items, k);
    this.drawKeyRow(items, field.x + field.w / 2, field.y + field.h - 20 * k, width > maxWidth ? (k * maxWidth) / width : k);
  }

  private keyRowMetrics(items: KeyItem[], k: number) {
    const { ctx } = this;
    const keyFont = `700 ${11 * k}px ${FONTS.mono}`;
    const labelFont = `400 ${12 * k}px ${FONTS.body}`;
    const padX = 6 * k;
    const gap = 7 * k;
    const sep = 22 * k;
    const widths = items.map(([key, label]) => {
      ctx.font = keyFont;
      const kw = key ? ctx.measureText(key).width + padX * 2 : 0;
      ctx.font = labelFont;
      return { kw, lw: ctx.measureText(label).width };
    });
    const total = widths.reduce((s, w) => s + w.kw + (w.kw ? gap : 0) + w.lw, 0) + sep * (items.length - 1);
    return { keyFont, labelFont, padX, gap, sep, widths, total };
  }

  private measureKeyRow(items: KeyItem[], k: number): number {
    return this.keyRowMetrics(items, k).total;
  }

  /** A centred row of keycaps with labels. */
  private drawKeyRow(items: KeyItem[], cx: number, y: number, k: number): void {
    const { ctx } = this;
    const { keyFont, labelFont, padX, gap, sep, widths, total } = this.keyRowMetrics(items, k);
    let x = cx - total / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    items.forEach(([key, label], i) => {
      const { kw, lw } = widths[i];
      if (key) {
        ctx.strokeStyle = rgba(COLORS.bone, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 0.5, y - 9 * k + 0.5, kw, 18 * k, 3 * k);
        ctx.stroke();
        ctx.fillStyle = COLORS.bone;
        ctx.font = keyFont;
        ctx.fillText(key, x + padX, y + 0.5 * k);
        x += kw + gap;
      }
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = labelFont;
      ctx.fillText(label, x, y + 0.5 * k);
      x += lw + sep;
    });
  }
}

/** How far out of the ship the aim line counts as the player's view of the shot (px at scale 1): what the aim card must not cover. */
const AIM_CLEAR = 420;

/** "Player 1 ▸ CPU 3  +1410  Swing-by · Bande ×1,88" as coloured pieces. */
function killSegments(match: Match, r: KillRecord): Segment[] {
  const victim = match.players[r.victim];
  if (r.killer === null) return [[t(r.source === 'sun' ? 'hud.sun' : 'hud.horizon'), COLORS.danger], [' ▸ ', COLORS.boneDim], [victim.name, victim.color]];
  if (r.self) return [[victim.name, victim.color], [t('hud.selfHit'), COLORS.boneDim], [`${r.points}`, COLORS.danger]];
  const killer = match.players[r.killer];
  if (r.friendly) {
    return [[killer.name, killer.color], [t('hud.friendlyFire'), COLORS.boneDim], [victim.name, victim.color], [`  ${r.points}`, COLORS.danger]];
  }
  const out: Segment[] = [[killer.name, killer.color], [' ▸ ', COLORS.boneDim], [victim.name, victim.color], [`  +${r.points}`, COLORS.bone]];
  if (r.combo.length) {
    out.push([`  ${r.combo.map((c) => styleLabel(c)).join(' · ')}`, COLORS.boneDim], [` ×${fmt(r.multiplier, 2)}`, COLORS.sodium]);
  }
  return out;
}

/** Rule tags and anomaly colors of the current daily sector. */
function modifierChips(match: ChallengeMatch): { labels: string[]; colors: string[]; glitching: number } {
  const mods = modifiersOf(match.spec);
  const anomalies = mods.filter((m): m is Anomaly => m in ANOMALY_COLORS);
  const others = mods.filter((m) => !(m in ANOMALY_COLORS));
  const ordered = [...anomalies, ...others];
  return {
    labels: ordered.map((m) => t(`daily.mod.${m}`)),
    colors: ordered.map((m) => (m in ANOMALY_COLORS ? ANOMALY_COLORS[m as Anomaly] : COLORS.boneDim)),
    glitching: anomalies.length,
  };
}

function nameLabel(p: PlayerState): string {
  return p.cpu ? `${p.name} · ${t(`cpu.${p.cpu}`)}` : p.name;
}

/** Left-aligned label padded to the width of the longer readout label, so the numbers line up. */
function pad(label: string): string {
  return label.padEnd(Math.max(t('hud.angle').length, t('hud.power').length), ' ');
}
