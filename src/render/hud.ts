import { modifiersOf } from '../challenge';
import { AIM, COLORS, FIELD, FONTS, TEAMS } from '../config';
import { ChallengeMatch, HorizonMatch, teamName, type KillRecord, type Match, type PlayerState } from '../game';
import { fmt, fmtInt, t, type Key } from '../i18n';
import { awardLabel, awardValue, awardWho, spotlight } from '../scorecard';
import { styleLabel } from '../scoring';
import { awards } from '../stats';
import type { View } from './backdrop';
import { rgba } from './color';
import type { DrawOptions } from './renderer';

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

  private shipPos: (i: number) => { x: number; y: number } = () => ({ x: 0, y: 0 });

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(match: Match, view: View, opts: DrawOptions, time: number, shipPos: (i: number) => { x: number; y: number }): void {
    this.time = time;
    this.shipPos = shipPos;
    this.k = Math.min(1.2, Math.max(0.72, view.scale));
    this.field = { x: view.offsetX, y: view.offsetY, w: FIELD.width * view.scale, h: FIELD.height * view.scale };

    const focus = match.focus;
    if (focus !== this.lastTurn) {
      this.lastTurn = focus;
      // In hot-seat games, say whose hands should be on the keyboard.
      if (focus >= 0 && !match.players[focus].cpu && match.humanCount > 1 && !match.simultaneous) this.turnAt = time;
    }

    const killcam = match instanceof HorizonMatch ? match.killcamInfo : null;
    if (killcam) {
      this.drawKillcam(match, killcam, opts);
      return;
    }

    if (match instanceof ChallengeMatch) {
      this.drawChallenge(match, opts);
      return;
    }

    const duel = match.mode === 'classic' && match.players.length === 2;
    this.drawRoundLabel(match);
    if (duel) {
      this.drawDuelBlock(match, match.players[0], 'left');
      this.drawDuelBlock(match, match.players[1], 'right');
    } else {
      this.drawScoreboard(match);
      this.drawKillFeed(match);
    }
    if (match.phase === 'aiming' && focus >= 0 && match.aimVisible(focus)) this.drawReadout(match, match.players[focus], shipPos(focus));
    this.drawNotice(match);
    if (time - this.turnAt < 1.6 && focus >= 0) this.drawTurnToast(match.players[focus]);
    if (match.phase === 'roundOver' && match.summary) {
      this.drawBanner(match, duel);
      this.drawScorecard(match);
    }
    this.drawHint(match, opts.touch);
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
    ctx.fillText(nameLabel(p).toUpperCase(), x, y);
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
    if (!hidden) this.drawGauge(align === 'left' ? x : x - 128 * k, y + 86 * k, 128 * k, p, align === 'right');
    ctx.globalAlpha = 1;
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

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${10 * k}px ${FONTS.body}`;
      setSpacing(ctx, 1.6 * k);
      ctx.fillText(p.name.toUpperCase(), x + 10 * k, y + 6 * k);
      setSpacing(ctx, 0);
      ctx.fillStyle = COLORS.bone;
      ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
      ctx.fillText(String(p.score), x + 10 * k, y + 19 * k);

      ctx.textAlign = 'right';
      ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
      const status = !p.alive ? ['✕', COLORS.boneDim] : active ? [t('hud.aiming'), p.color] : planning && p.locked ? [t('hud.ready'), COLORS.boneDim] : null;
      if (status) {
        ctx.fillStyle = status[1];
        ctx.fillText(status[0], x + w - 8 * k, y + 7 * k);
      }
      ctx.globalAlpha = 1;
      x += w + gap;
    });
  }

  private drawKillFeed(match: Match): void {
    const { ctx, k, field } = this;
    const entries = match.killFeed.filter((r) => match.clock - r.at < 6).slice(-4);
    let y = field.y + (match.teamMode ? 118 : 102) * k;
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
    this.drawGauge(x + 9 * k, y + h - 6 * k, w - 18 * k, p, false);

    const clock = match.shotClock;
    if (clock !== null) {
      ctx.textAlign = towardsCentre > 0 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${30 * k}px ${FONTS.display}`;
      ctx.fillStyle = clock < 4 ? COLORS.danger : COLORS.bone;
      ctx.fillText(String(Math.ceil(clock)), towardsCentre > 0 ? x + w + 10 * k : x - 10 * k, y + h / 2);
    }
  }

  private drawGauge(x: number, y: number, w: number, p: PlayerState, fromRight: boolean): void {
    const { ctx, k } = this;
    ctx.fillStyle = rgba(COLORS.line, 0.35);
    ctx.fillRect(x, y, w, 2 * k);
    ctx.fillStyle = p.color;
    const fill = (p.power / AIM.MAX_POWER) * w;
    ctx.fillRect(fromRight ? x + w - fill : x, y, fill, 2 * k);
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
    ctx.fillText(t(`daily.theme.${match.challenge.theme}` as Key).toUpperCase(), left, top + 28 * k);

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
  private drawChips(labels: string[], cx: number, y: number): void {
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
      ctx.strokeStyle = rgba(COLORS.sodium, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, widths[i], 17 * k, 3 * k);
      ctx.stroke();
      ctx.fillStyle = COLORS.sodium;
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
    ctx.fillStyle = rgba(COLORS.plate, 0.8);
    ctx.fillRect(field.x, cy - h / 2, field.w, h);
    ctx.fillStyle = rgba(color, 0.8);
    ctx.fillRect(field.x, cy - h / 2, field.w, 1);
    ctx.fillRect(field.x, cy + h / 2 - 1, field.w, 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = `800 ${(title.length > 16 ? 58 : title.length > 10 ? 70 : 84) * k}px ${FONTS.display}`;
    setSpacing(ctx, 6 * k);
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
    ctx.fillText(parts.join('  ·  '), cx, cy + 62 * k);
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
    ctx.font = `800 ${110 * k * pop}px ${FONTS.display}`;
    setSpacing(ctx, 8 * k);
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
    ctx.font = `800 ${34 * k}px ${FONTS.display}`;
    setSpacing(ctx, 3 * k);
    ctx.fillStyle = p.color;
    ctx.fillText(t('hud.turn', { name: p.name.toUpperCase() }), field.x + field.w / 2, field.y + field.h - 64 * k);
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
    ctx.fillStyle = rgba(COLORS.plate, 0.8);
    ctx.fillRect(field.x, cy - h / 2, field.w, h);
    ctx.fillStyle = rgba(color, 0.8);
    ctx.fillRect(field.x, cy - h / 2, field.w, 1);
    ctx.fillRect(field.x, cy + h / 2 - 1, field.w, 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = `800 ${(title.length > 10 ? 70 : 84) * k}px ${FONTS.display}`;
    setSpacing(ctx, 6 * k);
    ctx.fillText(title, cx + 3 * k, cy + 12 * k);
    setSpacing(ctx, 0);

    const kill = s.lastKill;
    let line1: string;
    let line2 = '';
    if (duel && kill && !kill.self && kill.killer !== null) {
      line1 = `${match.players[kill.killer].name}  +${kill.points}`;
      line2 = t('hud.shotPower', { n: kill.shots, power: fmt(kill.power, 2) });
    } else if (s.team !== null) {
      line1 = `${t('hud.teamWinsRound', { team: teamName(s.team) })}${s.bonus ? `  ·  ${t('hud.perMember', { n: s.bonus })}` : ''}`;
      if (kill) line2 = killSegments(match, kill).map(([text]) => text).join('');
    } else {
      line1 = survivor ? `${t('hud.winsRound', { name: survivor.name })}${s.bonus ? `  +${s.bonus}` : ''}` : t('hud.noSurvivor');
      if (kill) line2 = killSegments(match, kill).map(([text]) => text).join('');
    }
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    ctx.fillText(line1, cx, cy + 42 * k);
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    ctx.fillText(line2, cx, cy + 62 * k);
    ctx.globalAlpha = 1;
  }

  // ————————————————————————————— Killcam —————————————————————————————

  private drawKillcam(match: Match, info: NonNullable<HorizonMatch['killcamInfo']>, opts: DrawOptions): void {
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
    const horizon = match instanceof HorizonMatch;
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
    } else if (match.phase === 'collapse') {
      items = [['', t('hud.collapse')]];
    } else if (match.phase === 'roundOver' && match.phaseTime > 0.6) {
      const next = match.isLastRound ? t('hud.finalStandings') : match instanceof ChallengeMatch ? t('daily.hud.nextSector') : t('hud.nextRound');
      items = [match.canAdvance ? [touch ? '' : t('common.space'), next] : ['', t('hud.waitingHost')]];
      if (horizon && match.lastClip && !touch) items.push(['C', t('hud.saveKillcam')]);
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
  return modifiersOf(match.spec).map((m) => t(`daily.mod.${m}` as Key));
}

function nameLabel(p: PlayerState): string {
  return p.cpu ? `${p.name} · ${t(`cpu.${p.cpu}`)}` : p.name;
}

/** The text, cut with an ellipsis if it doesn't fit the width in the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > width) cut--;
  return `${text.slice(0, cut)}…`;
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Left-aligned label padded to the width of the longer readout label, so the numbers line up. */
function pad(label: string): string {
  return label.padEnd(Math.max(t('hud.angle').length, t('hud.power').length), ' ');
}
