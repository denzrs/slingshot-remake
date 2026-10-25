import { modifiersOf } from '../sim/challenge';
import { AIM, COLORS, FIELD, FONTS, MAYHEM, TEAMS } from '../sim/config';
import { ChallengeMatch, HorizonMatch, SKIP_VOTE_TIME, teamName, type KillRecord, type Match, type PlayerState } from '../game';
import { fmt, fmtInt, t } from '../platform/i18n';
import { TWIST_IDS, twistName } from '../game/mayhem';
import { awardLabel, awardValue, awardWho, spotlight } from '../game/scorecard';
import { styleLabel } from '../sim/scoring';
import { awards } from '../data/stats';
import type { View } from './backdrop';
import { drawAvatar } from './avatar';
import { rgba } from './color';
import { OracleHud, type OracleFrame, type OracleTap } from './oracle';
import { drawPowerUpSymbol, POWER_UP_COLORS } from './powerup-art';
import type { DrawOptions } from './renderer';
import { fitText, setSpacing } from './text';

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
  private k = 1;
  private field: Box = { x: 0, y: 0, w: 0, h: 0 };
  /** The whole canvas, for what takes over the screen and not just the field. */
  private screen = { w: 0, h: 0 };
  private readonly oracle = new OracleHud();

  private shipPos: (i: number) => { x: number; y: number } = () => ({ x: 0, y: 0 });

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** The oracle choice under a pointer (CSS pixels on the canvas), if there is one. */
  oracleHit(x: number, y: number): OracleTap | null {
    return this.oracle.hit(x, y);
  }

  draw(match: Match, view: View, opts: DrawOptions, time: number, shipPos: (i: number) => { x: number; y: number }): void {
    this.time = time;
    this.shipPos = shipPos;
    // On a phone the field is small, but its labels must stay readable: they get a higher floor.
    this.k = Math.min(1.2, Math.max(opts.touch ? 0.95 : 0.72, view.scale));
    this.screen = { w: view.cssWidth, h: view.cssHeight };
    this.field = view.stage ?? { x: view.offsetX, y: view.offsetY, w: FIELD.width * view.scale, h: FIELD.height * view.scale };

    const focus = match.focus;
    if (focus !== this.lastTurn) {
      this.lastTurn = focus;
      // In hot-seat games, say whose hands should be on the keyboard.
      if (focus >= 0 && !match.players[focus].cpu && match.humanCount > 1 && !match.simultaneous) this.turnAt = time;
    }

    this.oracle.begin();
    const frame: OracleFrame = { ctx: this.ctx, k: this.k, field: this.field, time, shipPos, keyHints: opts.keyHints && !opts.touch };
    const ghost = match.ghost;

    const killcam = match.killcamInfo;
    if (killcam) {
      this.drawKillcam(match, killcam, opts);
      this.drawSkipVote(match);
      if (ghost) this.oracle.drawKillcamVerdict(frame, match, opts.touch);
      return;
    }

    if (match instanceof ChallengeMatch) {
      this.drawChallenge(match, opts);
      return;
    }

    const duel = match.mode === 'classic' && match.players.length === 2;
    this.drawRoundLabel(match);
    this.drawTwistChips(match);
    if (duel) {
      this.drawDuelBlock(match, match.players[0], 'left');
      this.drawDuelBlock(match, match.players[1], 'right');
    } else {
      this.drawScoreboard(match);
      this.drawKillFeed(match);
    }
    if (match.phase === 'aiming' && focus >= 0 && match.aimVisible(focus)) this.drawReadout(match, match.players[focus], shipPos(focus));
    this.drawNotice(match);
    this.drawSkipVote(match);
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
    if (match.revealing) this.drawReveal(match);
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
    ctx.fillText(label, field.x + field.w / 2, field.y + 18 * k);
    setSpacing(ctx, 0);
  }

  /** A vote to skip the round: what is asked, how many have said yes, and what this person can do about it. */
  private drawSkipVote(match: Match): void {
    const vote = match.skipVote;
    if (!vote) return;
    const { ctx, k, field } = this;
    const lines = [t('skip.banner'), t('skip.votes', { yes: vote.yes.length, needed: match.skipVotesNeeded })];
    const me = match.viewer;
    const answer = me === null ? null : match.skipAnswer(me);
    if (match.canAnswerSkip(me)) lines.push(t('skip.hostAsks', { name: (match.players[vote.by]?.name ?? '').toUpperCase() }));
    else if (answer) lines.push(t('skip.answered', { answer: t(answer === 'yes' ? 'skip.answerYes' : 'skip.answerNo') }));
    else lines.push(t('skip.waiting'));
    const left = Math.max(0, vote.until - match.clock);
    const w = Math.min(field.w - 24 * k, 400 * k);
    const h = (lines.length * 20 + 18) * k;
    const x = field.x + field.w / 2 - w / 2;
    const y = field.y + 70 * k;
    ctx.fillStyle = rgba(COLORS.plate, 0.92);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillRect(x, y + h - 3 * k, (w * left) / SKIP_VOTE_TIME, 3 * k);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? `800 ${17 * k}px ${FONTS.display}` : `700 ${12.5 * k}px ${FONTS.mono}`;
      ctx.fillStyle = i === 0 ? COLORS.sodium : COLORS.bone;
      setSpacing(ctx, i === 0 ? 2 * k : 0);
      ctx.fillText(fitText(ctx, line, w - 20 * k), x + w / 2, y + (14 + i * 20 + 10) * k);
    });
    setSpacing(ctx, 0);
  }

  // ————————————————————————————— Mayhem —————————————————————————————

  /** The round's twists as chips under the round label, so nobody forgets what this round is about. */
  private drawTwistChips(match: Match): void {
    const round = match.mayhem;
    if (!round) return;
    const labels: string[] = [];
    const colors: string[] = [];
    if (round.finale) {
      labels.push(t('mayhem.finale'));
      colors.push(COLORS.danger);
    }
    for (const twist of round.twists) {
      labels.push(twistName(twist));
      colors.push(COLORS.sodium);
    }
    if (round.jackpot) {
      labels.push(t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR }));
      colors.push(COLORS.danger);
    }
    if (!round.twists.length && !round.finale && !round.jackpot) {
      labels.push(t('mayhem.quiet'));
      colors.push(COLORS.boneDim);
    }
    // The duel has its blocks in the corners; with a scoreboard across the top the chips go under it (and under its power-up strip).
    const duel = match.mode === 'classic' && match.players.length === 2;
    const below = duel ? 34 : (match.teamMode ? 66 : 50) + 40 + (match.powerUps ? 32 : 10);
    this.drawChips(labels, this.field.x + this.field.w / 2, this.field.y + (below + (duel ? 18 : 0)) * this.k, colors);
  }

  /**
   * The announcement of a Mayhem round: a band over the field in which each twist spins like a reel, slows down
   * and lands on its name, one after the other; the last lands together with the thud of the sound.
   */
  private drawReveal(match: Match): void {
    const round = match.mayhem;
    if (!round) return;
    const { ctx, k, field } = this;
    const left = match.revealEnd - match.clock;
    const age = MAYHEM.REVEAL_TIME - left;
    const alpha = Math.max(0, Math.min(1, age / 0.2, match.held ? 1 : left / 0.35));
    if (alpha <= 0) return;
    const cx = field.x + field.w / 2;
    const cy = field.y + field.h / 2;
    const rows = Math.max(1, round.twists.length);
    const rowH = 76 * k;
    const head = 62 * k;
    const foot = 38 * k;
    const jackpotH = round.jackpot ? 40 * k : 0;
    const h = head + rows * rowH + jackpotH + foot;
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

  /** Classic two-player layout: big blocks in the top corners, as in the original. */
  private drawDuelBlock(match: Match, p: PlayerState, align: 'left' | 'right'): void {
    const { ctx, k, field } = this;
    const x = align === 'left' ? field.x + 24 * k : field.x + field.w - 24 * k;
    const y = field.y + 22 * k;
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
  private drawScoreboard(match: Match): void {
    const { ctx, k, field } = this;
    const players = match.teamMode ? [...match.players].sort((a, b) => a.team! - b.team! || a.seat - b.seat) : match.players;
    const n = players.length;
    const gap = 8 * k;
    // Teams get a wider gap between groups.
    const groupGap = match.teamMode ? 22 * k : gap;
    const groups = match.teamMode ? new Set(players.map((p) => p.team)).size : 1;
    const w = Math.min(172 * k, (field.w - 48 * k - gap * (n - groups) - groupGap * (groups - 1)) / n);
    const h = 40 * k;
    const y = field.y + (match.teamMode ? 66 : 50) * k;
    const total = w * n + gap * (n - groups) + groupGap * (groups - 1);
    let x = field.x + (field.w - total) / 2;
    const planning = match.phase === 'aiming';

    players.forEach((p, i) => {
      const firstOfTeam = match.teamMode && (i === 0 || players[i - 1].team !== p.team);
      if (firstOfTeam) {
        if (i > 0) x += groupGap - gap;
        const team = match.teamRanking().find((r) => r.team === p.team)!;
        const width = w * team.members.length + gap * (team.members.length - 1);
        ctx.fillStyle = TEAMS[p.team!][0];
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
      ctx.globalAlpha = p.alive ? 1 : 0.38;
      ctx.fillStyle = rgba(COLORS.plate, 0.62);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, 3 * k, h);
      if (active) ctx.fillRect(x, y + h - 2 * k, w, 2 * k);

      // An online player's symbol leads the card, in the player's colour; the name and score sit beside it.
      const textX = p.avatar ? x + 26 * k : x + 10 * k;
      if (p.avatar) drawAvatar(ctx, p.avatar, x + 17 * k, y + h / 2, 16 * k, p.color);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${10 * k}px ${FONTS.body}`;
      setSpacing(ctx, 1.6 * k);
      ctx.fillText(p.name.toUpperCase(), textX, y + 6 * k);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.bone;
      ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
      ctx.fillText(String(p.score), textX, y + 19 * k);

      ctx.textAlign = 'right';
      ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
      const status = !p.alive ? ['✕', COLORS.boneDim] : active ? [t('hud.aiming'), p.color] : planning && p.locked ? [t('hud.ready'), COLORS.boneDim] : null;
      if (status) {
        ctx.fillStyle = status[1];
        ctx.fillText(status[0], x + w - 8 * k, y + 7 * k);
      }
      // The power-up area under the card: what the ship holds, and its key. Dead ships keep theirs out of sight.
      if (match.powerUps && p.alive) this.drawPowerUpSlot(p, x, y + h + 4 * k, 'left', match.placing && match.focus === p.id, w);
      ctx.globalAlpha = 1;
      x += w + gap;
    });
  }

  private drawKillFeed(match: Match): void {
    const { ctx, k, field } = this;
    const entries = match.killFeed.filter((r) => match.clock - r.at < 6).slice(-4);
    // Under the scoreboard's cards the power-up areas take a line, so the feed starts below them.
    let y = field.y + (match.teamMode ? 118 : 102) * k + (match.powerUps ? 30 * k : 0);
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

  /** Angle / power next to the aiming ship, plus the shot clock in Event Horizon. */
  private drawReadout(match: Match, p: PlayerState, at: { x: number; y: number }): void {
    const { ctx, k, field } = this;
    const towardsCentre = at.x < field.x + field.w / 2 ? 1 : -1;
    const w = 112 * k;
    const h = 44 * k;
    let x = at.x + towardsCentre * 40 * k - (towardsCentre < 0 ? w : 0);
    let y = at.y - h / 2;
    x = Math.min(field.x + field.w - w - 6, Math.max(field.x + 6, x));
    const top = match.mode === 'classic' && match.players.length === 2 ? 130 : match.teamMode ? 114 : 98;
    y = Math.min(field.y + field.h - h - 30 * k, Math.max(field.y + top * k, y));

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
    const left = field.x + 24 * k;
    const right = field.x + field.w - 24 * k;
    const top = field.y + 18 * k;
    ctx.textBaseline = 'top';

    // Left: which challenge, which theme.
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.sodium;
    ctx.font = `800 ${22 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    ctx.fillText(t('daily.hud.label', { n: match.challenge.number }), left, top);
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `700 ${10.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.8 * k);
    ctx.fillText(t(`daily.theme.${match.challenge.theme}`).toUpperCase(), left, top + 28 * k);

    // Centre: the sector, and the rules it plays by.
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${24 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    ctx.fillText(`${t('daily.hud.sector')} ${match.round} / ${match.totalRounds}`, field.x + field.w / 2, top);
    setSpacing(ctx, 0);
    this.drawChips(modifierLabels(match), field.x + field.w / 2, top + 34 * k);

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

    if (match.phase === 'aiming' && match.current >= 0) this.drawReadout(match, match.pilot, this.shipPos(match.current));
    if (match.phase === 'roundOver' && match.summary) this.drawChallengeBanner(match);
    this.drawHint(match, opts.touch);
  }

  /** Small outlined tags centred on `cx`, e.g. "BOUNCE". */
  private drawChips(labels: string[], cx: number, y: number, colors: string[] = []): void {
    if (!labels.length) return;
    const { ctx, k } = this;
    ctx.font = `700 ${9.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.4 * k);
    const padX = 7 * k;
    const gap = 6 * k;
    const widths = labels.map((l) => ctx.measureText(l.toUpperCase()).width + padX * 2);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1)) / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    labels.forEach((label, i) => {
      const color = colors[i] ?? COLORS.sodium;
      ctx.strokeStyle = rgba(color, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, widths[i], 17 * k, 3 * k);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label.toUpperCase(), x + padX, y + 9.5 * k);
      x += widths[i] + gap;
    });
    setSpacing(ctx, 0);
    ctx.textBaseline = 'top';
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
    // Up to five cards to a row; more wrap into a second row, each row centred.
    const perRow = list.length > 5 ? Math.ceil(list.length / 2) : list.length;
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
      ctx.fillText(awardValue(award), x + 11 * k, top + 22 * k);
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
    const color = s.team !== null ? TEAMS[s.team][0] : survivor?.color ?? COLORS.danger;
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
      line1 = survivor ? `${t('hud.winsRound', { name: survivor.name })}${s.bonus ? `  +${s.bonus}` : ''}` : t('hud.noSurvivor');
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
    ctx.fillStyle = rgba(COLORS.plate, 0.88);
    ctx.fillRect(field.x, field.y, field.w, bar);
    ctx.fillRect(field.x, field.y + field.h - bar, field.w, bar);

    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    ctx.fillStyle = rgba(COLORS.danger, pulse);
    ctx.beginPath();
    ctx.arc(field.x + 26 * k, field.y + bar / 2, 6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${24 * k}px ${FONTS.display}`;
    setSpacing(ctx, 3 * k);
    ctx.fillText(recording ? t('hud.recClip') : t('hud.killcam'), field.x + 40 * k, field.y + bar / 2 + 1);
    setSpacing(ctx, 0);

    if (slow) {
      ctx.textAlign = 'right';
      ctx.font = `700 ${14 * k}px ${FONTS.mono}`;
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(`${fmt(0.2, 1)}×`, field.x + field.w - 24 * k, field.y + bar / 2);
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
    } else if (match.phase === 'orbit') {
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

/** "Player 1 ▸ CPU 3  +1410  Swing-by · Bande ×1,88" as coloured pieces. */
function killSegments(match: Match, r: KillRecord): Segment[] {
  const victim = match.players[r.victim];
  if (r.killer === null) return [[t('hud.horizon'), COLORS.danger], [' ▸ ', COLORS.boneDim], [victim.name, victim.color]];
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

/** Rule tags of the current daily sector, e.g. ["Bounce", "Fixed power"]. */
function modifierLabels(match: ChallengeMatch): string[] {
  return modifiersOf(match.spec).map((m) => t(`daily.mod.${m}`));
}

function nameLabel(p: PlayerState): string {
  return p.cpu ? `${p.name} · ${t(`cpu.${p.cpu}`)}` : p.name;
}

/** Left-aligned label padded to the width of the longer readout label, so the numbers line up. */
function pad(label: string): string {
  return label.padEnd(Math.max(t('hud.angle').length, t('hud.power').length), ' ');
}
