import { interceptPoints } from '../sim/scoring';
import { AIM, ANOMALY, COLORS, FIELD, GRACE, KILLCAM, MAX_TRAILS_PER_PLAYER, MAYHEM, ORACLE, PHYSICS, SCORING, TRAIL_FADE } from '../sim/config';
import { seatColor, teamColor } from '../data/palette';
import { t } from '../platform/i18n';
import { applyTwists, MayhemDeck, setsPlanets, type MayhemRound } from './mayhem';
import { normalizeAngle, hasTrickShotSources, type ShotRules, type StyleKind, type World } from '../sim/physics';
import { createRng, randomSeed, type Rng } from '../sim/rng';
import { anomalyRules } from '../sim/anomalies';
import { bump, closestApproach, improve, newStatBook, pathLength, type StatBook } from '../data/stats';
import type { KillcamPlayback } from '../data/roomRules';
import { seatTeamsFor, startPower, type Settings } from '../data/settings';
import { Volley, type VolleyAim, type VolleyEvent, type VolleyShot } from '../sim/volley';
import { type Pickup } from '../sim/powerups';
import { generateWorld } from '../sim/world';
import { ShotLog } from './shotLog';
import { NEAR_MISS_GAP, type BanterCue } from './banter';
import { type ReplayTurn, type SeatChange, type SeatChangeKind, type SeatChangeWhen } from './replay';
import { Crowd } from './crowd';
import { Killcam } from './killcam';
import { Oracle, stakeOptions, type OracleKind } from './oracle';
import { PowerUpField } from './powerup-field';
import type { Experiment } from './experiments';
import { KillLedger } from './kill-ledger';
import { CpuDesk } from './cpu-desk';
import { ReplayDriver } from './replay-driver';
import { HostPause, type PauseState } from './host-pause';
import { SkipVoting } from './skip-vote';
import type { MatchSnapshot } from './match-types';

export * from './match-types';
import { newPlayer, atTable, shotDown, sidesOf, teamName, type Mode, type Phase, type PlayerState, type Trail, type KillRecord, type Falling, type RoundTitle, type SkipVote, type RoundSummary, type Scene, type GameEvent, type Bonus, type Mark, type MatchOptions } from './match-types';

/**
 * Everything the modes share: players, rounds, scoring, CPU thinking and flying volleys.
 * Subclasses decide how turns are structured.
 */
export abstract class Match {
  abstract readonly mode: Mode;
  world!: World;
  phase: Phase = 'aiming';
  /** Seconds spent in the current phase. */
  phaseTime = 0;
  /** Seconds since the match started. */
  clock = 0;
  round = 0;
  /** Rounds in this match (0 = endless) — fixed when the match starts. */
  totalRounds = 0;
  /** Planets hidden this round — fixed when the round starts. */
  hiddenPlanets = false;
  /** Number of teams in this match; 0 = free for all. Fixed when the match starts. */
  teamMode = 0;
  players: PlayerState[] = [];
  /** Player currently aiming, -1 if nobody. */
  current = -1;
  trails: Trail[] = [];
  volley: Volley | null = null;
  killFeed: KillRecord[] = [];
  lastKill: KillRecord | null = null;
  protected readonly killcam = new Killcam();
  summary: RoundSummary | null = null;
  /** Big transient announcement, e.g. "SALVE!". */
  notice: { text: string; color: string; at: number } | null = null;
  /** What happened this round, and in the whole match — for the scorecard. */
  roundStats: StatBook = newStatBook();
  /** Each shot of the round, for the host's report to the relay. */
  readonly shotLog = new ShotLog();
  matchStats: StatBook = newStatBook();
  /** Everybody's score at the start of the match and after every round — for the chart on the final screen. */
  scoreHistory: number[][] = [];
  /** The tipping game for eliminated players (online only). */
  readonly oracle = new Oracle();
  /**
   * The stands: people watching an online room play the same tipping game with an oracle of their own (so the pots never mix),
   * and — since they have no score in the match — a bankroll each, kept in `crowd`.
   */
  readonly stands = new Oracle(true);
  readonly crowd = new Crowd();
  /** Match clock when the current round began, so kills can be timed from the start of the round. */
  protected roundStartedAt = 0;
  /** How long the current round has run, in seconds of match clock. */
  get roundSeconds(): number {
    return this.clock - this.roundStartedAt;
  }
  /** Seed used to generate the current round's battlefield. */
  worldSeed = 0;
  /** Mayhem: how this round plays — its twists, whether it is the finale or a jackpot. Null when the match has no twists. */
  mayhem: MayhemRound | null = null;
  /** Mayhem: the match clock when the announcement of the round is over and the ships may aim. */
  revealEnd = 0;
  /** Mayhem: once the twists have landed, the announcement stays up until somebody dismisses it, so they can be read. */
  revealHeld = false;
  /**
   * Anomalies: the first round of a match that plays by them opens with an alarm, which names them. It is part of the
   * round's announcement (it holds the ships back, and the fire key dismisses it), with Mayhem's twists if there are any.
   */
  anomalyAlert = false;
  freeFireAnnounced = false;
  /** Mayhem: how every round of the match so far was played, for the recap. */
  mayhemHistory: MayhemRound[] = [];
  /** Mayhem: the rules the room was set up with. `settings` is these with the round's twists laid over them. */
  protected baseSettings: Settings;
  private deck: MayhemDeck | null = null;
  /** Online: the player sitting at this screen. null = hot-seat, where whoever is on turn is at the keyboard. */
  viewer: number | null = null;
  /** Whether this screen may move the match on (next round, skip the killcam, rematch). Online only the host may. */
  canAdvance = true;
  /** Online: this screen's place in the stands, if it sits there. It follows the match but takes no part in it. */
  spectatorId: number | null = null;

  protected rng: Rng;
  private readonly matchSeed: number;
  private worldRng: Rng;
  /** Phase time when the current volley finished, replicated so online guests keep the same post-flight delay. */
  protected flightDoneAt: number | null = null;
  /** What the volley in the air has destroyed so far — the oracle's verdict is read from it. */
  private oracleKills: { killer: number; victim: number; self: boolean; friendly: boolean }[] = [];
  /** Who shot whom, for the extras a kill pays and the marks on the cards. */
  private readonly ledger = new KillLedger({
    players: () => this.players,
    payFactor: () => this.payFactor,
    friendsOf: (id) => this.friendsOf(id),
    marksOpen: () => this.phase === 'aiming' && this.paysKillBonuses && !this.forfeited,
  });
  private disposed = false;
  /** The host's pause, and the vote to skip a round. */
  private readonly hostPause = new HostPause();
  private readonly skipVoting = new SkipVoting({
    clock: () => this.clock,
    voters: () => this.voters,
    canSkipRound: () => this.canSkipRound,
    skipRound: () => this.skipRound(),
    online: () => this.online,
    isCpu: (player) => !!this.players[player]?.cpu,
    said: (text) => {
      this.notice = { text: t(text), color: COLORS.boneDim, at: this.clock };
    },
  });
  /** The thinking of the CPUs. */
  protected readonly cpu = new CpuDesk({
    world: () => this.world,
    players: () => this.players,
    rules: () => this.rules,
    settings: () => this.settings,
    friendsOf: (id) => this.friendsOf(id),
    sparedFor: (id) => this.sparedFor(id),
    pickups: () => this.power.pickups,
    powerUps: () => this.powerUps,
    teleport: (id) => this.power.teleport(id),
    options: () => this.options,
    matchSeed: () => this.matchSeed,
    mode: () => this.mode,
    round: () => this.round,
  });
  private listeners: ((e: GameEvent) => void)[] = [];
  private turnListeners: (() => void)[] = [];
  private seatListeners: ((change: SeatChange) => void)[] = [];
  private banterListeners: ((cue: BanterCue) => void)[] = [];

  // ————————————————————————————— Replay —————————————————————————————

  /** Flies the recording when this match is a replay (`options.script`); idle in a game that is played. */
  protected readonly replay: ReplayDriver;

  /**
   * How the replay stands: `finished` when the recording has run out, `drifted` when the game stopped doing
   * what the recording says it did (a version that plays differently from the one that was recorded).
   */
  get replayState(): ReplayDriver['state'] {
    return this.replay.state;
  }

  set replayState(state: ReplayDriver['state']) {
    this.replay.state = state;
  }

  /** Whether this match flies a recording instead of being played. */
  get replaying(): boolean {
    return this.replay.active;
  }
  protected simClock = 0;
  /** Power-ups: the pickups on the field, who holds what, and what each one does. */
  readonly power = new PowerUpField({
    enabled: () => this.powerUps,
    world: () => this.world,
    players: () => this.players,
    rng: () => this.rng,
    rules: () => this.rules,
    volley: () => this.volley,
    phase: () => this.phase,
    viewer: () => this.viewer,
    current: () => this.current,
    localCanAim: () => this.localCanAim,
    canAim: (id) => this.canAim(id),
    friendsOf: (id) => this.friendsOf(id),
    sparedFor: (id) => this.sparedFor(id),
    volleysPerPass: () => this.volleysPerPass,
    kinds: () => this.settings.powerUpKinds,
    amount: () => this.settings.powerUpAmount,
    emit: (event) => this.emit(event),
    placed: (placement) => {
      this.shotLog.placed(placement);
      if (placement.kind === 'planetkiller') this.checkFreeFire();
    },
    clearCpuJobs: () => this.cpu.clear(),
    record: (update) => this.record(update),
  });

  constructor(
    public settings: Settings,
    protected readonly options: MatchOptions = {},
  ) {
    this.baseSettings = settings;
    this.matchSeed = options.seed ?? randomSeed();
    this.rng = createRng(this.matchSeed ^ 0x4f1bbcdc);
    this.worldRng = createRng(this.matchSeed);
    this.replay = new ReplayDriver(options.script, {
      round: () => this.round,
      turn: () => this.shotLog.turn,
      phase: () => this.phase,
      phaseTime: () => this.phaseTime,
      nextTurnKey: () => this.nextTurnKey(),
      removePlayer: (id) => this.removePlayer(id),
      setAway: (id, away) => this.setAway(id, away),
      placeLogged: (placement) => this.power.placeLogged(placement),
      splitInFlight: (player) => this.power.splitInFlight(player),
      skipRound: () => this.skipRound(),
      advance: () => this.advance(),
      updatePhase: (dt) => this.updatePhase(dt),
      playTurn: (turn) => this.playTurn(turn),
    });
    if (options.script) this.power.scripted = true;
  }

  /** Rebuilt only when what it is made from changes: the renderer asks for it every frame. */
  private rulesMemo: { rules: ShotRules; edges: string; shotTime: number; powerCap: number; anomalies: readonly string[]; seed: number; world: World | undefined; version: number; sources: number } | null = null;

  /** What a flight plays by: the edges and shot time, with the anomalies on top. Trick Shots Only gives way to direct fire once the field offers nothing to arm a shot with. */
  get rules(): ShotRules {
    const { edges, shotTime, anomalies } = this.settings;
    const powerCap = this.settings.fixedPower ? this.settings.fixedPowerLevel : this.settings.maxPower;
    const { world, worldSeed } = this;
    const sources = world ? world.planets.length + world.holes.length + world.wormholes.length : 0;
    const memo = this.rulesMemo;
    if (memo && memo.edges === edges && memo.shotTime === shotTime && memo.powerCap === powerCap && memo.anomalies === anomalies && memo.seed === worldSeed && memo.world === world && memo.version === (world?.version ?? 0) && memo.sources === sources) return memo.rules;
    const rules: ShotRules = { edges, timeLimit: shotTime, ...anomalyRules(anomalies, shotTime, worldSeed, powerCap) };
    if (rules.trickShots && world && !hasTrickShotSources(world, rules)) rules.trickShots = false;
    this.rulesMemo = { rules, edges, shotTime, powerCap, anomalies, seed: worldSeed, world, version: world?.version ?? 0, sources };
    return rules;
  }
  /** Enter / "ready": classic fires, Event Horizon locks the aim in. */
  abstract commit(): void;
  protected abstract beginRound(): void;
  protected abstract updatePhase(dt: number): void;
  protected abstract afterVolley(): void;
  protected abstract killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number };
  protected abstract get survivorBonus(): number;
  /** Whether trick shots multiply a hit's points in this match. */
  protected get stylePays(): boolean {
    return true;
  }
  /**
   * Whether kills pay the extras on top: the multi-kill chain, first blood, the bounty and revenge. The daily challenge
   * keeps a score of its own and runs a target per round rather than a round per volley, so they have no meaning there.
   */
  get paysKillBonuses(): boolean {
    return this.mode !== 'challenge';
  }
  protected abstract roundTitle(survivor: number | null): RoundTitle;

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Told when a CPU has something to say about how a shot went. Kept off the wire: the host is the one who speaks for the CPUs. */
  onBanter(listener: (cue: BanterCue) => void): void {
    this.banterListeners.push(listener);
  }

  private cue(kind: BanterCue['kind'], player: number, other: number | null): void {
    if (!this.players[player]?.cpu) return;
    for (const l of this.banterListeners) l({ kind, player, other });
  }

  /** Told of every change at the table as it happens (host): a recording keeps them, as a replay has no room to hear them from. */
  onSeatChange(listener: (change: SeatChange) => void): void {
    this.seatListeners.push(listener);
  }

  /** Called when a turn's shots have all landed and the scores are settled, before the next phase begins. */
  onTurnEnd(listener: () => void): void {
    this.turnListeners.push(listener);
  }

  /** Stop this match for good when it leaves the application. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetFlight();
    this.listeners.length = 0;
    this.turnListeners.length = 0;
    this.seatListeners.length = 0;
  }

  private resetFlight(): void {
    this.flightDoneAt = null;
    this.cpu.clear();
  }

  /** Dispatch authoritative events on clients that do not run the simulation. */
  applyRemoteEvent(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get attract(): boolean {
    return !!this.options.attract;
  }

  /** Whether this match plays by the experiment: asked for, and in a game that nobody else shares or watches back. */
  protected trying(name: Experiment): boolean {
    return !!this.options.experiments?.includes(name) && !this.online && !this.attract && !this.replaying;
  }

  /** The experiments this match plays by, for the dev panel's chip. */
  get experiments(): readonly Experiment[] {
    return (this.options.experiments ?? []).filter((name) => this.trying(name));
  }

  /** The tutorial's field: its coach says what matters, so the HUD leaves out the round and the score block. */
  get practice(): boolean {
    return false;
  }

  get isHumanTurn(): boolean {
    if (this.replaying || this.phase !== 'aiming' || this.current < 0 || this.revealing) return false;
    const p = this.players[this.current];
    return !p.cpu && !p.locked;
  }

  /** Whether all shots of a round of aiming fly at once (Event Horizon, or Classic with simultaneous shots), not one per turn. */
  get salvo(): boolean {
    return false;
  }

  /** Whether every human aims at once (online salvos) rather than in turns. */
  get simultaneous(): boolean {
    return !!this.options.simultaneous;
  }

  /** Whether a human may change this player's aim right now. */
  canAim(id: number): boolean {
    const p = this.players[id];
    // Nobody aims in a replay: the recording does.
    if (this.replaying) return false;
    return this.phase === 'aiming' && !this.revealing && this.current === id && !!p && !p.cpu && !p.locked;
  }

  get spectating(): boolean {
    return this.spectatorId !== null;
  }

  /** The oracle this screen plays in: the stands' for a spectator, else the shot-down players'. */
  get betOracle(): Oracle {
    return this.spectating ? this.stands : this.oracle;
  }

  /** Who this screen tips as: its place in the stands, or its ship; null in hot-seat. */
  get bettor(): number | null {
    return this.spectating ? this.spectatorId : this.viewer;
  }

  /** Whether stakes are on: the shot-down need the room's rule for it, the stands bet with their own points anyway. */
  get bettingOn(): boolean {
    return this.spectating || this.settings.betting;
  }

  /** What a bettor has to stake: a player's score in the match, or a spectator's bankroll. */
  purse(id: number, crowd = this.spectating): number {
    return (crowd ? this.crowd.seat(id)?.balance : this.players[id]?.score) ?? 0;
  }

  private payInto(id: number, amount: number, crowd: boolean): void {
    const seat = crowd ? this.crowd.seat(id) : undefined;
    if (seat) seat.balance += amount;
    else if (!crowd && this.players[id]) this.players[id].score += amount;
  }

  /** Who a tip came from, as a name and a colour: a ship, or somebody in the stands. */
  tipster(id: number): { name: string; color: string } | undefined {
    if (!this.spectating) return this.players[id];
    const seat = this.crowd.seat(id);
    return seat && { name: seat.name, color: seatColor(id) };
  }

  /** Which side a ship is on: its team, or itself. Teammates win and lose together. */
  sideOf(id: number): number {
    return this.players[id]?.team ?? id;
  }

  /** Whether the person at this screen may tip in the oracle: shot down, or in the stands. */
  get ghost(): boolean {
    if (this.spectating) return !!this.options.oracle && !!this.crowd.seat(this.spectatorId)?.present;
    const me = this.viewer === null ? undefined : this.players[this.viewer];
    return !!this.options.oracle && !!me && shotDown(me);
  }

  get oracleEnabled(): boolean {
    return !!this.options.oracle;
  }

  /** Whether this screen is allowed to see the oracle's live information. The living only see its round summary. */
  get canSeeOracle(): boolean {
    return this.ghost || this.phase === 'roundOver';
  }

  /** Whether this bettor may tip right now: shot down (or in the stands), and a question is open. */
  canBet(id: number, crowd = this.spectating): boolean {
    if (!this.options.oracle) return false;
    const o = crowd ? this.stands : this.oracle;
    if (!o.question || o.question.locked) return false;
    if (crowd) return !!this.crowd.seat(id)?.present;
    const p = this.players[id];
    return !!p && shotDown(p);
  }

  /** Whether the oracle's minimum window for tipping and betting on this aiming phase has passed. */
  protected get betWindowDone(): boolean {
    const asked = this.oracle.question || this.oracle.roundQuestion || this.stands.question || this.stands.roundQuestion;
    return !asked || this.phaseTime >= ORACLE.MIN_BET_TIME;
  }

  /**
   * Puts a stake on the bettor's tip on the round question, once. The points leave their purse at once —
   * they come back with a share of the pot if the tip was right, or when there is nobody to share with.
   */
  private placeStake(id: number, stake: number, crowd: boolean): boolean {
    if (stake > this.maxStake(id, crowd) || !(crowd ? this.stands : this.oracle).setStake(id, stake)) return false;
    this.payInto(id, -stake, crowd);
    return true;
  }

  /** The ships a tip on who wins the round may name right now: the ones still in. */
  get roundChoices(): number[] {
    return (this.betOracle.roundQuestion?.choices ?? []).filter((id) => this.alive.some((p) => p.id === id));
  }

  /** Whether this bettor may tip on who wins the round right now: the question is open, and the next shots have not flown yet. */
  canBetRound(id: number, crowd = this.spectating): boolean {
    if (!this.options.oracle || this.phase !== 'aiming' || !(crowd ? this.stands : this.oracle).roundQuestion) return false;
    if (crowd) return !!this.crowd.seat(id)?.present;
    const p = this.players[id];
    return !!p && shotDown(p);
  }

  /** The most this bettor could still stake on the round question: a share of their purse, once. 0 when there is no bet to make — or the room plays without betting. */
  maxStake(id: number, crowd = this.spectating): number {
    if (!(crowd || this.settings.betting) || !this.canBetRound(id, crowd) || !(crowd ? this.stands : this.oracle).canStake(id)) return 0;
    return stakeOptions(this.purse(id, crowd)).at(-1) ?? 0;
  }

  /**
   * A tip — on the open shot or salvo, or (`round`) on who wins the round, with an optional `stake` of the
   * bettor's own points on it. `crowd` says it comes from the stands, not from a shot-down player; a screen
   * in the stands means that by itself. The host keeps it until the verdict; a screen also remembers its own to show it.
   */
  placeBet(id: number, pick: number, round = false, stake = 0, crowd = this.spectating): boolean {
    const o = crowd ? this.stands : this.oracle;
    const mine = id === this.bettor && crowd === this.spectating;
    if (round) {
      if (!this.canBetRound(id, crowd) || !o.betRound(id, pick, this.alive.map((p) => p.id), this.sidesIn)) return false;
      if (mine) o.roundMine = { id: o.roundQuestion!.id, pick };
      if (stake > 0) this.placeStake(id, stake, crowd);
      return true;
    }
    if (!this.canBet(id, crowd) || !o.bet(id, pick)) return false;
    if (mine) o.mine = { id: o.question!.id, pick };
    return true;
  }

  /**
   * Once somebody is out and two or more ships are still in a contested round, the oracle asks who wins it.
   * Called whenever the aiming begins; a round has one such question. The stands' oracle asks it from the
   * start of the round, once somebody is watching, since they have no ship to lose.
   */
  private openRoundQuestion(): void {
    if (!this.options.oracle || this.attract || this.decided) return;
    if (!this.oracle.roundQuestion && this.players.some(shotDown)) this.oracle.openRound(this.alive.map((p) => p.id), this.simultaneous);
    if (!this.stands.roundQuestion && this.crowd.watching) this.stands.openRound(this.alive.map((p) => p.id), this.simultaneous);
  }

  /** The people in the stands changed (host): keep the list, and let a newcomer bet on the round already under way. */
  crowdChanged(people: readonly { id: number; name: string }[]): void {
    this.crowd.sync(people);
    if (this.phase === 'aiming') this.openRoundQuestion();
  }

  /** Subclasses call this when a shot (`shot`, by `shooter`) or a salvo is about to be aimed. */
  protected openOracle(kind: OracleKind, shooter = -1): void {
    const live = !!this.options.oracle && !this.attract;
    const choices = kind === 'salvo' ? this.alive.map((p) => p.id) : [];
    if (live && this.players.some(shotDown)) this.oracle.open(kind, shooter, choices);
    else this.oracle.close();
    if (live && this.crowd.watching) this.stands.open(kind, shooter, choices);
    else this.stands.close();
  }

  private judgeOracle(): void {
    const victims = [...new Set(this.oracleKills.map((k) => k.victim))];
    for (const o of [this.oracle, this.stands]) {
      const q = o.question;
      if (q) o.resolve(victims, this.oracleKills.some((k) => k.killer === q.shooter && !k.self && !k.friendly), this.clock);
    }
    this.oracleKills = [];
  }

  /** Whether the person at this screen may aim right now. */
  get localCanAim(): boolean {
    if (this.spectating) return false;
    return this.viewer === null ? this.isHumanTurn : this.canAim(this.viewer);
  }

  /** Whose aim the screen shows: whoever is on turn — or, while everyone aims at once, the local player. */
  get focus(): number {
    return this.simultaneous && this.viewer !== null && this.canAim(this.viewer) ? this.viewer : this.current;
  }

  /**
   * Whether this player's aim (arrow, angle, ship heading) may be drawn. With hidden aim only the
   * person at the screen sees it: their own seat online, whoever is on turn at a shared keyboard.
   */
  aimVisible(id: number): boolean {
    if (!this.settings.hiddenAim || this.attract) return true;
    // Nobody in the stands has a ship, so nobody has an aim of their own to see.
    if (this.spectating) return false;
    if (this.viewer !== null) return id === this.viewer;
    return id === this.focus && !this.players[id]?.cpu;
  }

  /** How visible a finished shot's trail still is (1 → 0). Always 1 unless trails fade. */
  trailAlpha(trail: Trail): number {
    const life = this.settings.fadingTrails;
    if (!life) return 1;
    const hold = life * TRAIL_FADE.HOLD;
    return Math.max(0, Math.min(1, (life - (this.clock - trail.at)) / (life - hold)));
  }

  get humanCount(): number {
    return this.players.filter((p) => !p.cpu).length;
  }

  get planetsVisible(): boolean {
    return !this.hiddenPlanets || this.phase === 'roundOver' || this.phase === 'gameOver';
  }

  get isLastRound(): boolean {
    return this.totalRounds > 0 && this.round >= this.totalRounds;
  }

  /** The ships in the round: not shot down, and not off the field while their person is away. */
  get alive(): PlayerState[] {
    return this.players.filter((p) => p.alive && !p.away);
  }

  /** Players by score, best first; whoever left the game comes after those who played it out, score or not. */
  ranking(): PlayerState[] {
    return [...this.players].sort((a, b) => Number(a.left) - Number(b.left) || b.score - a.score || a.seat - b.seat);
  }

  /** The single leader among those still in the game, or null on a tie at the top. */
  get leader(): number | null {
    const [a, b] = this.ranking().filter((p) => !p.left);
    if (!a) return null;
    return !b || a.score > b.score ? a.id : null;
  }

  /** Team totals, best first (empty in free for all). */
  teamRanking(): { team: number; score: number; members: PlayerState[] }[] {
    const teams = [...new Set(this.players.flatMap((p) => (p.team === null ? [] : [p.team])))];
    return teams
      .map((team) => {
        const members = this.players.filter((p) => p.team === team);
        return { team, members, score: members.reduce((sum, p) => sum + p.score, 0) };
      })
      .sort((a, b) => b.score - a.score || a.team - b.team);
  }

  /** Who is ahead in the match — a team in team mode, a player otherwise; null on a tie. */
  winner(): { name: string; color: string } | null {
    if (this.teamMode) {
      const [a, b] = this.teamRanking();
      return !b || a.score > b.score ? { name: teamName(a.team), color: teamColor(a.team) } : null;
    }
    const leader = this.leader;
    return leader === null ? null : { name: this.players[leader].name, color: this.players[leader].color };
  }

  /**
   * Neighbour grace period: the ships this player's next shot flies through. While a round is young
   * (each ship's first `neighborGrace` shots) that is the nearest enemy, so nobody can just snipe their neighbour.
   */
  sparedFor(id: number): number[] {
    const me = this.players[id];
    if (!this.settings.neighborGrace || !me || this.players.length < GRACE.MIN_SHIPS || me.shots >= this.settings.neighborGrace) return [];
    const from = this.world.ships[id];
    const friends = this.friendsOf(id);
    let nearest = -1;
    let best = Infinity;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      // A ship off the field while its person is away is nobody's neighbour.
      if (p.id === id || !p.alive || p.away || friends.includes(p.id)) continue;
      const d = Math.hypot(ship.x - from.x, ship.y - from.y);
      if (d < best) {
        best = d;
        nearest = p.id;
      }
    }
    return nearest < 0 ? [] : [nearest];
  }

  /** Teammates of a player (empty in free for all). */
  friendsOf(id: number): number[] {
    const team = this.players[id].team;
    return team === null ? [] : this.players.filter((p) => p.id !== id && p.team === team).map((p) => p.id);
  }

  /**
   * The round is settled by the ships of those at the table: one whose person is away does not keep it open, so a
   * round left with one side at the table is over, and it never goes to the away ship. Only with nobody at the table
   * in the round, and nobody there shot down either, does it wait for those away.
   */
  get decided(): boolean {
    const alive = this.players.filter((p) => p.alive);
    const present = alive.filter(atTable);
    if (present.length) return sidesOf(present) <= 1;
    // Away ships cannot win by default once nobody still at the table has survived.
    if (this.players.some((p) => atTable(p) && !p.alive)) return true;
    return sidesOf(alive) <= 1;
  }

  /** How many sides still have ships in the round: lone players in a free for all, whole teams in a team match. */
  get sidesIn(): number {
    return sidesOf(this.alive);
  }

  /** The round is only still on because those away have ships in it, and nobody at the table has: it waits for them. */
  get waitingForAway(): boolean {
    return this.sidesIn <= 1 && !this.decided;
  }

  scene(): Scene {
    return this.killcam.scene() ?? { world: this.world, trails: this.trails, volley: this.volley, camera: null, ...this.power.scene() };
  }

  // ————————————————————————————— Power-ups —————————————————————————————

  /** Power-ups are an offline experiment: Classic and Event Horizon, never on the attract screen, never online. */
  get powerUps(): boolean {
    return this.settings.powerUps && this.mode !== 'challenge' && !this.attract;
  }

  /** Volleys that make up one pass: the shot of every ship still in, or one salvo at a time. */
  protected get volleysPerPass(): number {
    return this.salvo ? 1 : Math.max(1, this.alive.length);
  }

  get pickups(): Pickup[] {
    return this.power.pickups;
  }

  set pickups(pickups: Pickup[]) {
    this.power.pickups = pickups;
  }

  /** The power-up key: opens a teleport's aim, or arms a preview. */
  usePowerUp(id: number = this.viewer ?? this.current): void {
    this.power.use(id);
  }

  /** Whether the ship on turn is aiming a teleport or a black hole. */
  get placing(): boolean {
    return this.power.placing;
  }

  /** Whether a given ship is aiming a placement. */
  placingFor(id: number): boolean {
    return this.power.placingFor(id);
  }

  /** Fire, while aiming: the jump happens, or the black hole is planted. False when there is no aim, or it lands nowhere the ship may rest. */
  confirmPlacement(by?: number): boolean {
    // In a salvo the others are still aiming against the field as it is: the placement waits for the volley.
    return this.power.confirmPlacement(by, this.salvo);
  }

  cancelPlacement(by?: number): boolean {
    return this.power.cancelPlacement(by);
  }

  /** The power-up state a snapshot carries besides the pickups, and its restoring. */
  protected get powerState() {
    return this.power.state();
  }

  /** Fire while the shot is flying: an armed splitter forks it into three. */
  protected splitInFlight(id = -1): boolean {
    return this.power.splitInFlight(id);
  }

  /** A salvo takes off: the placements it held back are made first, so the shots fly over the field they were laid on. */
  protected makeHeldPlacements(): void {
    this.power.makeHeld();
  }

  protected aimsFor(p: PlayerState): VolleyAim[] {
    this.shotLog.carry(p.id, p.powerUp, p.armed);
    return this.power.aimsFor(p);
  }

  // Event Horizon hooks the renderer asks about; classic answers "nothing".
  /** What is falling into a black hole right now. */
  falling(): Falling[] {
    return [];
  }
  devourProgress(_planetSeed: number): number {
    return 0;
  }
  swallowProgress(_ship: number): number {
    return 0;
  }
  /** How far the wormhole with this id has fallen into the hole (0 to 1). */
  devourWormhole(_id: number): number {
    return 0;
  }
  get nextHoleRadius(): number | null {
    return null;
  }
  get shotClock(): number | null {
    return null;
  }

  /** What the modes share of a snapshot: every mode puts its own turn state on top of this (see `MatchSnapshot`). */
  protected baseSnapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      phaseTime: this.phaseTime,
      clock: this.clock,
      round: this.round,
      worldSeed: this.worldSeed,
      totalRounds: this.totalRounds,
      hiddenPlanets: this.hiddenPlanets,
      teamMode: this.teamMode,
      players: this.players.map((player) => ({ ...player })),
      current: this.current,
      world: this.world,
      trails: this.trails,
      volley: this.volley?.snapshot() ?? null,
      pickups: this.pickups,
      power: this.powerState,
      killFeed: this.killFeed,
      lastKill: this.lastKill,
      summary: this.summary,
      notice: this.notice,
      settings: this.settings,
      mayhem: this.mayhem,
      revealEnd: this.revealEnd,
      revealHeld: this.revealHeld,
      anomalyAlert: this.anomalyAlert,
      mayhemHistory: this.mayhemHistory,
      roundStats: this.roundStats,
      matchStats: this.matchStats,
      scoreHistory: this.scoreHistory,
      skipVote: this.skipVote,
      pause: this.pause,
      flightDoneAt: this.flightDoneAt,
      ...this.killcam.snapshot(),
      oracle: this.oracle.snapshot(),
      stands: this.stands.snapshot(),
      crowd: this.crowd.snapshot(),
      marks: this.ledger.state(),
    };
  }

  /**
   * Puts a host's snapshot back (guests): the part the modes share. False when it does not fit this match (a different number of
   * ships than players), which a mode answers by leaving its own fields as they are. Fields an older host does not send keep their defaults.
   */
  protected restoreBase(s: MatchSnapshot): boolean {
    if (s.world.ships.length !== s.players.length) return false;
    this.settings = s.settings;
    this.mayhem = s.mayhem ?? null;
    this.revealEnd = s.revealEnd ?? 0;
    this.revealHeld = s.revealHeld ?? false;
    this.anomalyAlert = s.anomalyAlert ?? false;
    this.mayhemHistory = s.mayhemHistory ?? [];
    this.phase = s.phase;
    this.phaseTime = s.phaseTime;
    this.clock = s.clock;
    this.round = s.round;
    this.worldSeed = s.worldSeed ?? 0;
    this.totalRounds = s.totalRounds;
    this.hiddenPlanets = s.hiddenPlanets;
    this.teamMode = s.teamMode;
    this.players = s.players.map((player) => ({ ...player }));
    this.current = s.current;
    this.world = s.world;
    this.trails = s.trails;
    this.pickups = s.pickups ?? [];
    this.power.restoreState(s.power);
    this.killFeed = s.killFeed;
    this.lastKill = s.lastKill;
    this.summary = s.summary;
    this.notice = s.notice;
    this.roundStats = s.roundStats;
    this.matchStats = s.matchStats;
    this.scoreHistory = s.scoreHistory;
    this.skipVote = s.skipVote ?? null;
    this.pause = s.pause ?? null;
    // Hosts from before the oracle send none.
    if (s.oracle) this.oracle.restore(s.oracle);
    if (s.stands) this.stands.restore(s.stands);
    this.crowd.restore(s.crowd);
    this.ledger.restore(s.marks);
    this.volley = null;
    if (s.volley) {
      const volley = new Volley(s.world, s.volley.aims, this.rules, true);
      volley.restore(s.volley);
      this.volley = volley;
    }
    this.killcam.restore(s, this.rules);
    this.restarted();
    this.flightDoneAt = s.flightDoneAt ?? null;
    return true;
  }

  newMatch(): void {
    this.worldRng = createRng(this.options.seed ?? randomSeed());
    this.rng = createRng(this.matchSeed ^ 0x4f1bbcdc);
    this.cpu.newMatch();
    this.ledger.newMatch();
    const seats = this.options.seats ?? this.settings.seats;
    const taken = seats.flatMap((seat, i) => (seat === 'off' ? [] : [{ seat: i, kind: seat }]));
    const teams = this.attract ? null : (this.options.teams ?? seatTeamsFor(this.settings, taken.map((s) => s.seat)));
    this.teamMode = teams ? this.settings.teamMode : 0;
    // Whoever left the game stays out of the rematch, and whoever dropped out is still away: the room says so.
    const before = this.players;
    this.players = taken.map(({ seat, kind }, id) => newPlayer(id, seat, kind, teams?.[id] ?? null, false, this.options.names?.[id], this.options.avatars?.[id] ?? null));
    for (const p of this.players) {
      p.left = !!before[p.id]?.left;
      p.away = !!before[p.id]?.away;
    }
    if (teams) {
      // Each team member gets its own shade of the team colour.
      const seen = new Map<number, number>();
      for (const p of this.players) {
        const n = seen.get(p.team!) ?? 0;
        seen.set(p.team!, n + 1);
        p.shade = n;
      }
    }
    this.round = 0;
    this.clock = 0;
    this.killFeed = [];
    this.matchStats = newStatBook();
    this.scoreHistory = [this.players.map(() => 0)];
    this.mayhemHistory = [];
    this.oracle.reset(this.players.length);
    this.stands.reset(0);
    this.crowd.reset();
    this.totalRounds = this.attract ? 0 : this.settings.rounds;
    this.settings = this.baseSettings;
    // The deck gets its seed from the world's stream only when there are twists, so a match without any plays as ever.
    this.deck = this.mayhemOn ? new MayhemDeck(Math.floor(this.worldRng() * 2 ** 32)) : null;
    this.startRound();
  }

  startRound(): void {
    this.killcam.reset();
    this.resetFlight();
    this.ledger.startRound();
    this.skipVoting.clear();
    this.forfeited = false;
    this.round++;
    // Stakes that were never paid out (a round cut short) go back to their owners.
    for (const [id, stake] of this.oracle.stakes) this.payInto(id, stake, false);
    for (const [id, stake] of this.stands.stakes) this.payInto(id, stake, true);
    this.oracle.startRound();
    this.stands.startRound();
    this.crowd.relief();
    this.oracleKills = [];
    this.roundStats = newStatBook();
    this.shotLog.reset();
    this.roundStartedAt = this.clock;
    this.worldSeed = Math.floor(this.worldRng() * 2 ** 32);
    this.rollTwists();
    this.raiseAnomalyAlert();
    this.world = generateWorld(this.worldSeed, {
      maxPlanets: this.settings.maxPlanets,
      players: this.players.length,
      blackHole: this.mode === 'horizon',
      solar: this.mode === 'solar',
      exactPlanets: this.mayhem !== null && setsPlanets(this.mayhem),
      teams: this.teamMode ? this.players.map((p) => p.team!) : null,
    });
    this.hiddenPlanets = (this.mode === 'classic' || this.mode === 'solar') && this.settings.invisiblePlanets;
    this.trails = [];
    this.volley = null;
    this.summary = null;
    this.lastKill = null;
    // A grudge lasts one round — whoever survived it starts the next one clean.
    this.cpu.startRound();
    const duel = this.mode === 'classic' && this.players.length === 2;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      p.shots = 0;
      p.alive = !p.left;
      if (p.left || p.away) ship.alive = false;
      p.locked = false;
      p.passed = false;
      p.powerUp = null;
      p.armed = false;
      // Face the middle of the field; the classic duel keeps the original's straight 0° / 180°.
      p.angle = duel ? (p.id === 0 ? 0 : 180) : normalizeAngle(Math.round((Math.atan2(ship.y - FIELD.height / 2, FIELD.width / 2 - ship.x) * 180) / Math.PI));
      p.power = startPower(this.settings);
    }
    this.ledger.scoresAtStart(this.players.map((p) => p.score));
    this.freeFireAnnounced = false;
    this.checkFreeFire();
    this.power.startRound();
    this.emit({ type: 'round' });
    this.beginRound();
  }

  /** Whether this match plays by twists: Mayhem is on, in a game against other ships and not on the title screen. */
  private get mayhemOn(): boolean {
    return this.baseSettings.mayhem > 0 && !this.attract && this.mode !== 'challenge';
  }

  /** Draws the twists of the round about to start and lays them over the room's rules, or puts the room's rules back. */
  private rollTwists(): void {
    if (!this.deck) {
      this.mayhem = null;
      this.settings = this.baseSettings;
      return;
    }
    this.mayhem = this.deck.draw({ base: this.baseSettings, mode: this.mode === 'challenge' ? 'classic' : this.mode, round: this.round, rounds: this.totalRounds });
    this.settings = applyTwists(this.baseSettings, this.mayhem);
    this.revealEnd = this.clock + MAYHEM.REVEAL_TIME;
    // A match nobody is flying in (CPUs only) has no one to wait for.
    this.revealHeld = this.players.some((p) => !p.cpu);
  }

  /** Whether this match plays by anomalies: some are on, in a game against other ships and not on the title screen. */
  private get anomaliesOn(): boolean {
    return this.baseSettings.anomalies.length > 0 && !this.attract && this.mode !== 'challenge';
  }

  /** Anomalies: the first round sounds the alarm (and in Mayhem every round), for as long as an announcement of Mayhem's lasts (sharing it when there is one). */
  private raiseAnomalyAlert(): void {
    this.anomalyAlert = (this.round === 1 || this.mayhemOn) && this.anomaliesOn;
    if (!this.anomalyAlert) return;
    this.revealEnd = this.clock + MAYHEM.REVEAL_TIME;
    // A match nobody is flying in (CPUs only) has no one to wait for.
    this.revealHeld = this.players.some((p) => !p.cpu);
  }

  /** Trick Shots Only: when the battlefield has no trick-shot sources left, direct fire is armed and announced. */
  checkFreeFire(): void {
    if (this.freeFireAnnounced || this.decided || !this.settings.anomalies?.includes('trickShots') || !this.world) return;
    if (!hasTrickShotSources(this.world, { edges: this.settings.edges, timeLimit: this.settings.shotTime })) {
      this.freeFireAnnounced = true;
      this.notice = { text: t('notice.freeFire'), color: COLORS.danger, at: this.clock };
      this.emit({ type: 'freeFire' });
    }
  }

  /** Mayhem: the announcement is waiting for somebody to dismiss it (and gives up after `HELD_MAX`). */
  get held(): boolean {
    return this.revealHeld && this.clock < this.revealEnd + MAYHEM.HELD_MAX;
  }

  /** Mayhem: seconds since the round was announced. */
  get revealAge(): number {
    return this.clock - (this.revealEnd - MAYHEM.REVEAL_TIME);
  }

  /** Mayhem or the anomalies' alarm: the round has been announced, but the ships are still held back. */
  get revealing(): boolean {
    return (this.mayhem !== null || this.anomalyAlert) && (this.clock < this.revealEnd || this.held);
  }

  /** The fire key during the announcement ends it instead of firing. True when it did. */
  skipReveal(): boolean {
    if (!this.revealing) return false;
    this.revealEnd = this.clock;
    this.revealHeld = false;
    return true;
  }

  /** The fire key while a replay holds a finished shot on the field ends the hold. True when it did. */
  skipHold(): boolean {
    return false;
  }

  /** Mayhem: what every point of this round is worth — a jackpot round pays and costs double. */
  protected get payFactor(): number {
    return this.mayhem?.jackpot ? MAYHEM.JACKPOT_FACTOR : 1;
  }

  /** Nudge the current player's aim (human input). */
  adjust(dAngle: number, dPower: number): void {
    if (!this.isHumanTurn) return;
    const p = this.players[this.current];
    this.setAim(p.angle + dAngle, p.power + dPower);
  }

  setAim(angle: number, power: number): void {
    if (!this.isHumanTurn) return;
    const p = this.players[this.current];
    p.angle = normalizeAngle(angle);
    if (!this.settings.fixedPower) p.power = Math.min(this.settings.maxPower, Math.max(AIM.MIN_POWER, power));
  }

  /** Called when settings change mid-match: only display options follow along, the rules stay as the game started. */
  applySettings(settings: Settings): void {
    this.settings.contours = settings.contours;
    this.baseSettings.contours = settings.contours;
  }

  private get killcamMode(): KillcamPlayback {
    if (this.mode === 'challenge') return 'off';
    const choice = this.settings.killcam ?? 'auto';
    return choice === 'auto' ? (this.salvo ? 'every' : 'off') : choice;
  }

  /** Round-end playback returns to the completed summary, so scores and mode transitions run once. */
  private showRoundKillcam(): void {
    if (this.killcamMode === 'round' && this.lastClip) this.startKillcam(this.lastClip, 'roundOver', false);
  }

  get lastClip() {
    return this.killcam.lastClip;
  }

  get canReplay(): boolean {
    return this.mode !== 'challenge' && !!this.lastClip && (this.phase === 'roundOver' || (this.phase === 'killcam' && !this.killcam.active?.recording));
  }

  /** Saving is offered while the killcam is on screen, not again on its result screen. */
  get canSaveClip(): boolean {
    return this.phase === 'killcam' && this.canReplay;
  }

  get killcamInfo() {
    return this.killcam.info(this.skipsNeeded);
  }

  /** At least half of the human players must want to skip; target drones, CPUs and whoever is not at the table do not vote. */
  private get skipsNeeded(): number {
    return Math.ceil(this.players.filter((p) => !p.cpu && !p.target && atTable(p)).length / 2);
  }

  voteSkip(player: number): void {
    const k = this.killcam.active;
    const p = this.players[player];
    if (!p || p.cpu || p.target || !atTable(p) || !k || k.recording || this.phaseTime <= 0.3 || k.skipVotes.includes(player)) return;
    k.skipVotes.push(player);
    if (k.skipVotes.length >= this.skipsNeeded) this.endKillcam();
  }

  /** Replay the last kill, keeping the pending mode transition or the round summary to return to. */
  replayLastKill(recording: boolean): boolean {
    if (!this.lastClip || !this.canReplay) return false;
    const returnTo = this.phase === 'killcam' ? this.killcam.active!.returnTo : this.phase;
    this.startKillcam(this.lastClip, returnTo, recording);
    return true;
  }

  private startKillcam(clip: NonNullable<Match['lastClip']>, returnTo: Phase | null, recording: boolean): void {
    this.killcam.start(clip, returnTo, recording, this.rules);
    this.setPhase('killcam');
    this.emit({ type: 'killcam', active: true, recording });
  }

  private endKillcam(): void {
    const k = this.killcam.active!;
    this.killcam.active = null;
    this.emit({ type: 'killcam', active: false, recording: k.recording });
    if (k.returnTo) this.setPhase(k.returnTo);
    else this.nextVolley();
  }

  /**
   * The volley is over: the next turn is given out. In a replay, what came at the table between the two turns comes first, as on
   * the host, where it came before the turn was handed out (in a killcam the replay may not show, or that showed it already).
   */
  private nextVolley(): void {
    this.replay.seatChanges(this.nextTurnKey(), 'between');
    this.afterVolley();
  }

  // ————————————————————————————— Leaving —————————————————————————————

  /**
   * Online (host): the person in this seat left the game. Their ship is gone at once and in every round
   * after, their score stays as it was, and nobody waits for them: a round left with one side in it is over.
   */
  removePlayer(id: number): void {
    const p = this.players[id];
    if (!p || p.left) return;
    this.noteSeatChange(id, 'left');
    const open = !this.decided;
    p.left = true;
    p.alive = false;
    p.locked = false;
    if (this.world.ships[id]) this.world.ships[id].alive = false;
    // Their going is what settled the round, whenever it then ends: it is a walkover.
    if (open && this.decided) this.forfeited = true;
    // Fewer at the table may already carry a vote (which can end the round here).
    this.tableChanged();
    if (this.phase !== 'aiming') return;
    if (this.decided) this.endRound();
    else this.passTurnOf(id);
  }

  /** The round was settled by somebody leaving it, not by a shot: it ends as a walkover. */
  private forfeited = false;

  /** The room's news about a seat goes into the recording, with the moment it came at: a replay has no room to hear it from. */
  private noteSeatChange(player: number, change: SeatChangeKind): void {
    // Once the game is over there is no turn left for it to change.
    if (this.replaying || this.phase === 'gameOver' || (this.phase === 'killcam' && this.killcam.active?.returnTo === 'gameOver')) return;
    // The turn it belongs to: the one in the air, the one being aimed, or the next one to go off. It need not ever go off.
    const when: SeatChangeWhen = this.phase === 'flying' ? 'flight' : this.phase === 'aiming' ? 'aiming' : 'between';
    const at = when === 'flight' ? { round: this.round, turn: this.shotLog.turn } : when === 'aiming' ? { round: this.round, turn: this.shotLog.turn + 1 } : this.nextTurnKey();
    const step = when === 'flight' ? { at: this.volley?.steps ?? 0 } : {};
    for (const listener of this.seatListeners) listener({ ...at, player, change, when, ...step });
  }

  /**
   * The turn the next volley will be, as the recording numbers it: the first of the next round once this one is over. A killcam
   * counts as the phase it goes back to, so one shown at a round's end is already past that round.
   */
  private nextTurnKey(): { round: number; turn: number } {
    const phase = this.phase === 'killcam' ? this.killcam.active?.returnTo : this.phase;
    return phase === 'roundOver' || phase === 'gameOver' ? { round: this.round + 1, turn: 1 } : { round: this.round, turn: this.shotLog.turn + 1 };
  }

  /**
   * Online (host): the person in this seat dropped out (`away`), or is back. Meanwhile their ship is off the field,
   * where nothing can hit it, and the round goes on as if they were not there: their turns are passed over, a volley
   * does not wait for them, and a round that ends without them leaves them as they were. Back in the same round, the
   * ship is where it was and they play on — at once in a volley still being aimed, else from their next turn.
   */
  setAway(id: number, away: boolean): void {
    const p = this.players[id];
    if (!p || p.left || p.away === away) return;
    this.noteSeatChange(id, away ? 'away' : 'back');
    p.away = away;
    this.tableChanged();
    if (!p.alive) return;
    // Keep the ship hittable until the next volley launches; a disconnect during aim cannot dodge the shot.
    if (this.world.ships[id] && !away) this.world.ships[id].alive = true;
    p.locked = false;
    p.passed = false;
    if (this.phase !== 'aiming') return;
    // Their dropping out may leave one side at the table: that round is over.
    if (away && this.decided) this.endRound();
    else if (away) this.passTurnOf(id);
    else this.giveTurnBackTo(id);
  }

  /** The ships of those away that were left on the field while shots were in the air go off it now. */
  private parkAway(): void {
    for (const p of this.players) if (p.alive && p.away && this.world.ships[p.id]) this.world.ships[p.id].alive = false;
  }

  /**
   * Somebody left the table or came back to it: the votes are counted again for the people at it now. A vote that
   * already has enough of them carries at once; a leaver's answer no longer counts.
   */
  private tableChanged(): void {
    const k = this.killcam.active;
    if (k) {
      k.skipVotes = k.skipVotes.filter((id) => atTable(this.players[id]));
      if (!k.recording && k.skipVotes.length && k.skipVotes.length >= this.skipsNeeded) this.endKillcam();
    }
    this.skipVoting.tableChanged();
  }

  /**
   * A seat that just left (or dropped out) is passed over: in a volley aimed one after another it leaves the
   * queue, and the next in it aims when it was on turn. Modes with turns of their own override this.
   */
  protected passTurnOf(id: number): void {
    const queue = this.volleyQueue();
    if (!queue) return;
    const at = queue.indexOf(id);
    if (at >= 0) queue.splice(at, 1);
    if (this.current === id) this.nextInQueue();
  }

  /**
   * A seat is back while aiming goes on: its turn in the volley was passed over, so it aims after those still
   * waiting, or at once when nobody is. Modes with turns of their own override this.
   */
  protected giveTurnBackTo(id: number): void {
    const queue = this.volleyQueue();
    if (!queue || this.current === id || queue.includes(id)) return;
    queue.push(id);
    if (this.current < 0) this.nextInQueue();
  }

  /** Who is still to aim in a volley aimed one after another, null when the volley is not aimed that way. */
  protected volleyQueue(): number[] | null {
    return null;
  }

  /** The next in `volleyQueue` takes the turn. */
  protected nextInQueue(): void {}

  // ————————————————————————————— Skipping a round —————————————————————————————

  /** The host's pause (see `HostPause`): null while the game runs. */
  get pause(): PauseState {
    return this.hostPause.state;
  }

  set pause(state: PauseState) {
    this.hostPause.state = state;
  }

  /** Host only: stop the game for everybody until it is resumed. */
  pauseGame(): void {
    this.hostPause.stop(this.canAdvance && this.online && !this.replaying);
  }

  /** Host only: start the countdown that ends the pause. */
  resumeGame(): void {
    this.hostPause.resume();
  }

  /** The vote to skip the round that is open, if any. Online only: offline the player simply skips. */
  get skipVote(): SkipVote | null {
    return this.skipVoting.vote;
  }

  set skipVote(vote: SkipVote | null) {
    this.skipVoting.vote = vote;
  }

  /** Whether this match is played online, against the people of a room. */
  protected get online(): boolean {
    return !!this.options.oracle;
  }

  /** Whether a round is on that could be skipped right now. */
  get canSkipRound(): boolean {
    if (this.attract || this.replaying || this.mode === 'challenge' || this.revealing) return false;
    // Only a killcam in the middle of a round returns to nothing; one that returns to a phase replays a round already decided.
    if (this.phase === 'killcam') return this.killcam.active?.returnTo === null;
    return this.phase === 'aiming' || this.phase === 'flying' || this.phase === 'collapse';
  }

  /** The people at the table: they are the ones who vote. */
  private get voters(): number[] {
    return this.players.filter((p) => !p.cpu && atTable(p)).map((p) => p.id);
  }

  /** Yes votes it takes to skip: more than half of the people at the table. */
  get skipVotesNeeded(): number {
    return this.skipVoting.needed;
  }

  /** Offline the player skips on their own; online only the host may ask, which opens a vote (see `SkipVoting`). */
  requestSkipRound(player: number): void {
    this.skipVoting.request(player);
  }

  /** One person's answer to the open vote; it counts once. */
  voteSkipRound(player: number, yes: boolean): void {
    this.skipVoting.answer(player, yes);
  }

  /** How this person has answered the open vote, null while they have not (or when they have no say). */
  skipAnswer(player: number): 'yes' | 'no' | null {
    return this.skipVoting.answerOf(player);
  }

  /** Whether this person may still answer the open vote. */
  canAnswerSkip(player: number | null): boolean {
    return this.skipVoting.canAnswer(player);
  }

  /** Mode-specific loose ends of a round cut short: a killcam in the making, a collapse under way. */
  protected abandonRound(): void {}

  /** Ends the round where it stands: whatever was scored in it is taken back, and the match goes on as after any round. */
  protected skipRound(): void {
    this.skipVoting.clear();
    // A volley still in the air is no turn of the round: its report would never come, and the round's own would not add up.
    if (this.volley) this.shotLog.abandonTurn();
    this.volley = null;
    this.flightDoneAt = null;
    this.cpu.clear();
    this.killcam.reset();
    this.abandonRound();
    // Back to what everybody had when the round began (this also gives back what was staked on the oracle's questions).
    const before = this.scoreHistory[this.scoreHistory.length - 1];
    for (const p of this.players) p.score = before[p.id] ?? 0;
    for (const [id, stake] of this.oracle.stakes) this.payInto(id, stake, false);
    for (const [id, stake] of this.stands.stakes) this.payInto(id, stake, true);
    this.oracle.rollbackRound();
    this.stands.rollbackRound();
    this.oracle.startRound();
    this.stands.startRound();
    // The extras went back with the points, and the round's kills are no grudge: revenge and domination read the rounds as if this one was never played.
    this.matchStats.bonuses.splice(this.matchStats.bonuses.length - this.roundStats.bonuses.length);
    this.roundStats.bonuses = [];
    this.ledger.rollbackRound();
    this.summary = { title: 'skipped', survivor: null, team: null, bonus: 0, lastKill: null };
    this.scoreHistory.push(before.slice());
    if (this.mayhem) this.mayhemHistory.push(this.mayhem);
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
  }

  /** Space / "continue": next round, final screen, or a new match. */
  advance(): void {
    if (this.pause) return;
    if (this.phase === 'killcam') {
      if (!this.killcam.active!.recording && this.phaseTime > 0.3) this.endKillcam();
      return;
    }
    if (this.phaseTime < 0.6) return;
    if (this.phase === 'roundOver') {
      if (this.isLastRound) {
        this.setPhase('gameOver');
        this.emit({ type: 'gameOver' });
      } else {
        this.startRound();
      }
    } else if (this.phase === 'gameOver') {
      this.newMatch();
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.pause) return this.hostPause.tick(dt);
    this.clock += dt;
    this.phaseTime += dt;
    if (this.notice && this.clock - this.notice.at > 1.4) this.notice = null;
    this.skipVoting.tick();
    // A replay has no one to press a key: it lets the announcement be read, then goes on.
    if (this.replaying && this.revealing && this.revealAge > 2.5) this.skipReveal();
    // The round's announcement holds everything still: no aiming, no CPU thinking, no shot clock.
    if (this.revealing) return;
    if (this.phase === 'killcam') {
      // A replay's killcam is a phase between two turns like any other: what came at the table during it comes now.
      this.replay.seatChanges(this.nextTurnKey(), 'between');
      if (this.killcam.update(dt, (volley, event) => this.onVolleyEvent(volley, event, false))) this.endKillcam();
    } else if (this.phase === 'flying') this.updateFlight(dt);
    else if (this.replaying) this.replay.update(dt);
    else this.updatePhase(dt);
    if (this.phase === 'roundOver' && this.attract && this.phaseTime > 3) this.advance();
  }

  // ————————————————————————————— Flight —————————————————————————————

  protected launch(aims: VolleyAim[], trackStyle: boolean): void {
    this.oracle.lock();
    this.stands.lock();
    this.oracleKills = [];
    this.killcam.capture(this.world, aims);
    this.volley = new Volley(this.world, aims, this.rules, trackStyle);
    this.shotLog.launched(this.volley.shots, aims);
    this.ledger.launched(this.players.map((p) => p.score));
    this.simClock = 0;
    this.flightDoneAt = null;
    this.cpu.clear();
    this.setPhase('flying');
    this.volley.shots.forEach((vs, i) => {
      const aim = aims[i];
      this.emit({ type: 'fire', player: vs.owner, x: vs.shot.x, y: vs.shot.y, angle: aim.angle, power: aim.power });
    });
  }

  /** Flies a turn of the recording, the way the mode flies its own. */
  protected playTurn(_turn: ReplayTurn): void {
    this.replayState = 'drifted';
  }

  /** Long flights speed up so nobody waits for an orbit to decay. */
  private get flightSpeed(): number {
    const t = this.phaseTime;
    return t < 3 ? 1 : Math.min(4, 1 + (t - 3) * 0.75);
  }

  private updateFlight(dt: number): void {
    if (!this.volley) return;
    const volley = this.volley;
    this.simClock += dt * this.flightSpeed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.replay.makeSplits(volley);
      this.replay.flightSeatChanges(volley, false);
      this.simClock -= PHYSICS.DT;
      for (const e of volley.step()) this.onVolleyEvent(volley, e, true);
      this.power.onStep(volley);
    }
    if (!volley.done) return;
    // Those that came after the last step (while the finished flight was on screen): before anything the flight's end does.
    this.replay.flightSeatChanges(volley, true);
    this.flightDoneAt ??= this.phaseTime;
    if (this.phaseTime - this.flightDoneAt < this.afterVolleyDelay) return;
    this.recordFlights(volley);
    this.shotLog.splits(volley.script);
    this.trails.push(...volley.shots.map((vs) => ({ owner: vs.owner, fan: vs.fan, points: vs.trail, volley: this.volleyNumber, at: this.clock })));
    this.pruneTrails();
    this.volley = null;
    this.power.onVolleyEnd();
    this.judgeOracle();
    for (const listener of this.turnListeners) listener();
    const clip = this.killcam.finish(volley.script, this.killcamMode === 'round');
    if (clip && this.killcamMode === 'every') this.startKillcam(clip, null, false);
    else this.nextVolley();
  }

  /**
   * Guests carry a flight on between the host's snapshots, so it moves smoothly instead of in 30 Hz
   * steps. The physics is deterministic, so this is exactly what the host is about to send; it is
   * purely visual — hits, events and scores only ever come from the host.
   */
  extrapolate(dt: number): void {
    const volley = this.volley;
    if (this.pause || this.phase !== 'flying' || !volley) return;
    this.phaseTime += dt;
    this.simClock += dt * this.flightSpeed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.simClock -= PHYSICS.DT;
      volley.step();
    }
  }

  /** A fresh snapshot replaced the state: the extrapolation starts over from it. */
  protected restarted(): void {
    this.resetFlight();
    this.simClock = 0;
  }

  /** Seconds to keep a finished volley on screen before moving on (e.g. before a killcam). */
  protected get afterVolleyDelay(): number {
    return this.killcam.hasKills && (this.killcamMode === 'every' || (this.killcamMode === 'round' && this.decided)) ? KILLCAM.DELAY : 0;
  }

  protected get volleyNumber(): number {
    return 0;
  }

  /** A long round piles up finished trails; each player keeps only their newest ones. */
  private pruneTrails(): void {
    const kept = new Map<number, number>();
    const drop = new Set<Trail>();
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      const n = (kept.get(t.owner) ?? 0) + 1;
      kept.set(t.owner, n);
      if (n > MAX_TRAILS_PER_PLAYER) drop.add(t);
    }
    if (drop.size) this.trails = this.trails.filter((t) => !drop.has(t));
  }

  /** Turn a simulation event into game events. `live` = the real volley, not a killcam replay. */
  protected onVolleyEvent(volley: Volley, e: VolleyEvent, live: boolean): void {
    const vs = volley.shots[e.index];
    const player = vs.owner;
    if (e.type === 'style') {
      if (live && (e.event.kind === 'swingby' || e.event.kind === 'graze')) this.record((book) => bump(e.event.kind === 'swingby' ? book.swingbys : book.grazes, player));
      // The call-out promises a multiplier, so it only shows where trick shots pay.
      if (this.stylePays) this.emit({ type: 'style', player, kind: e.event.kind, x: e.event.x, y: e.event.y });
      return;
    }
    if (e.type === 'intercept') {
      const d = volley.world.defenses[e.defense];
      if (d) this.emit({ type: 'defenseFire', player: d.owner, x: d.x, y: d.y, toX: e.x, toY: e.y });
      if (d && live) this.record((book) => bump(book.missiles, d.owner));
      return;
    }
    if (e.type === 'interceptMiss') {
      const d = volley.world.defenses[e.defense];
      if (d) this.emit({ type: 'defenseMiss', player: d.owner, x: e.x, y: e.y });
      return;
    }
    if (e.type === 'wreck') {
      this.emit({ type: 'defenseWrecked', player: volley.world.defenses[e.defense].owner, by: player, x: e.x, y: e.y });
      return;
    }
    if (e.type === 'reflect') {
      // The shield bounced the shot off: it is spent, and so is the power-up it came from.
      this.emit({ type: 'shield', ship: e.ship, x: e.x, y: e.y });
      if (live) {
        const holder = this.players[e.ship];
        holder.powerUp = null;
        holder.armed = false;
        this.record((book) => bump(book.saves, e.ship));
      }
      return;
    }
    if (e.type === 'pierce') {
      // Armor piercing went through the hull (or a blast took it): the ship is out, and the shot flies on.
      this.emit({ type: 'explode', x: e.x, y: e.y, ship: e.ship, vx: e.vx, vy: e.vy });
      if (live) this.creditKill(vs, e.ship, volley);
      return;
    }
    if (e.type === 'arm') {
      this.emit({ type: 'armed', player, x: e.x, y: e.y });
      // A fork, a stray missile or a melted shot is armed on its own: only the shots a player fired count, a share of `shots`.
      if (live && this.shotLog.fired(vs)) this.record((book) => bump(book.arms, player));
      return;
    }
    if (e.type === 'warn') {
      this.emit({ type: 'warning', player, ship: e.ship, x: e.x, y: e.y });
      return;
    }
    if (e.type === 'planetShatter') {
      this.emit({ type: 'planetShatter', x: e.x, y: e.y, radius: e.radius, color: e.color });
      if (live) this.record((book) => bump(book.shatters, player));
      this.checkFreeFire();
      return;
    }
    if (e.type === 'bump') {
      this.emit({ type: 'impact', player, x: e.x, y: e.y, vx: e.vx, vy: e.vy });
      if (live) this.record((book) => bump(book.bumps, player));
      return;
    }
    if (e.type === 'loop' || e.type === 'whiteHole') {
      if (live) this.record((book) => bump(e.type === 'loop' ? book.loops : book.returns, player, e.count));
      return;
    }
    if (e.type === 'fusion') {
      this.emit({ type: 'fusion', players: [volley.shots[e.from[0]].owner, volley.shots[e.from[1]].owner], x: e.x, y: e.y });
      return;
    }
    const end = e.end;
    if (live) this.shotLog.ended(vs, end.kind);
    switch (end.kind) {
      case 'ship': {
        const ship = volley.world.ships[end.ship];
        this.emit({ type: 'explode', x: ship.x, y: ship.y, ship: end.ship, vx: e.vx, vy: e.vy });
        if (live) this.creditKill(vs, end.ship, volley);
        break;
      }
      case 'blast':
        // Its victims were taken a moment before, as the blast's own events.
        this.emit({ type: 'blast', player, x: e.x, y: e.y });
        break;
      case 'fused':
        // The melting was shown by the shot it made.
        break;
      case 'planet': {
        const planet = end.surface ?? volley.world.planets[end.planet];
        const dx = e.x - planet.x;
        const dy = e.y - planet.y;
        const distance = Math.hypot(dx, dy) || 1;
        const x = planet.x + (dx / distance) * (planet.radius + 2);
        const y = planet.y + (dy / distance) * (planet.radius + 2);
        this.emit({ type: 'impact', player, x, y, vx: e.vx, vy: e.vy });
        break;
      }
      case 'hole': {
        const hole = volley.world.holes[end.hole];
        this.emit({ type: 'devour', x: e.x, y: e.y, toX: hole.x, toY: hole.y, color: seatColor(this.players[player].seat), vx: e.vx, vy: e.vy });
        break;
      }
      case 'shotdown': {
        const d = volley.world.defenses[end.defense];
        const points = d ? interceptPoints(end.chance) * this.payFactor : 0;
        this.emit({ type: 'shotdown', player, x: e.x, y: e.y, vx: e.vx, vy: e.vy, points });
        if (d && live) {
          this.record((book) => bump(book.intercepts, d.owner));
          this.players[d.owner].score += points;
        }
        break;
      }
      case 'clash': {
        if (e.index >= end.other) break;
        const otherOwner = volley.shots[end.other].owner;
        const other = volley.shots[end.other].shot;
        const team = this.players[player].team;
        const friendly = team !== null && team === this.players[otherOwner].team;
        // A high-five pays both shooters whose shots cancelled each other — and only where trick shots pay.
        const points = this.stylePays ? (friendly ? SCORING.HIGH_FIVE_TEAMMATE : SCORING.HIGH_FIVE_ENEMY) * this.payFactor : 0;
        if (live && points > 0) {
          this.players[player].score += points;
          this.players[otherOwner].score += points;
          this.shotLog.bonus(vs, points);
          this.shotLog.bonus(volley.shots[end.other], points);
        }
        this.emit({
          type: 'clash',
          x: e.x,
          y: e.y,
          players: [player, otherOwner],
          velocities: [{ x: e.vx, y: e.vy }, { x: other.vx, y: other.vy }],
          points,
        });
        break;
      }
      default:
        this.emit({ type: 'fizzle', player, x: e.x, y: e.y, vx: e.vx, vy: e.vy, lost: end.kind === 'lost' });
    }
  }

  /**
   * A shot took a ship: its owner's kill, or (Fusion) one the two owners of a melted shot share, each at half. A melted
   * shot that takes one of its own owners is no own goal for them: the other owner has the kill, still at half.
   */
  private creditKill(vs: VolleyShot, victim: number, volley: Volley): void {
    if (vs.partner === undefined) return this.registerKill(vs, victim, volley);
    const owners = [vs.owner, vs.partner];
    const killers = owners.includes(victim) ? owners.filter((owner) => owner !== victim) : owners;
    killers.forEach((killer, i) => this.registerKill(vs, victim, volley, killer, ANOMALY.FUSION_SHARE, i > 0));
  }

  /**
   * Notes a kill and pays for it. `killer` is the shot's owner, unless a melted shot is shared out (`share` of every
   * point to each owner); the second of those is an `echo`, which the killcam and the oracle have already seen.
   */
  private registerKill(vs: VolleyShot, victim: number, volley: Volley, killer = vs.owner, share = 1, echo = false): void {
    const self = killer === victim;
    const friendly = !self && this.players[killer].team !== null && this.players[killer].team === this.players[victim].team;
    const hit = self || friendly ? { points: -SCORING.SELF_HIT, combo: [], multiplier: 1 } : vs.stray ? { points: SCORING.COLLATERAL, combo: [], multiplier: 1 } : this.killPoints(vs);
    const score = { ...hit, points: Math.round(hit.points * this.payFactor * share) };
    this.players[victim].alive = false;
    if (!echo) this.oracleKills.push({ killer, victim, self, friendly });
    this.players[killer].score += score.points;
    this.shotLog.hit(vs, victim, self ? 'self' : friendly ? 'friendly' : 'enemy', score.points);
    if (self) this.cue('ownGoal', killer, null);
    else if (!friendly) {
      this.cue('kill', killer, victim);
      this.cue('died', victim, killer);
    }
    const enemyKill = !self && !friendly;
    const paysExtras = enemyKill && this.paysKillBonuses;
    const bonuses = paysExtras ? this.ledger.killBonuses(killer, victim, !!vs.stray).map((b) => ({ ...b, points: Math.round(b.points * share) })) : [];
    if (enemyKill) {
      // A CPU hit by an enemy remembers it — level profiles with a grudge aim back.
      this.cpu.noteHit(victim, killer);
      this.ledger.noteKill(killer, victim);
    }
    const record: KillRecord = {
      killer,
      victim,
      self,
      friendly,
      ...(vs.stray ? { collateral: true } : {}),
      points: score.points,
      combo: score.combo,
      multiplier: score.multiplier,
      shots: this.players[killer].shots,
      power: vs.shot.power,
      at: this.clock,
    };
    if (self) this.record((book) => bump(book.ownGoals, killer));
    if (enemyKill) {
      const seconds = this.clock - this.roundStartedAt;
      const from = volley.world.ships[killer];
      const target = volley.world.ships[victim];
      const shot = { trail: vs.trail, at: { x: target.x, y: target.y } };
      this.record((book) => {
        bump(book.kills, killer);
        if (vs.stray) bump(book.strayKills, killer);
        book.fastestKill = improve(book.fastestKill, killer, seconds, false, shot);
        book.bestHit = improve(book.bestHit, killer, score.points, true, shot);
        book.sniper = improve(book.sniper, killer, Math.hypot(target.x - from.x, target.y - from.y), true, shot);
      });
    }
    this.recordKill(record);
    // The kill chain: a second enemy in the round pays extra, whether it came in this turn or an earlier one.
    if (paysExtras) {
      const { kills, points: bonus } = this.ledger.extendChain(killer, share);
      if (bonus > 0) {
        this.players[killer].score += bonus;
        this.shotLog.bonus(vs, bonus);
        this.emit({ type: 'multiKill', player: killer, kills, points: bonus, x: volley.world.ships[victim].x, y: volley.world.ships[victim].y });
      }
    }
    if (bonuses.length) this.shotLog.bonus(vs, this.payBonuses(killer, bonuses, volley.world.ships[victim]));
    if (!echo) this.killcam.record(record, volley.shots.indexOf(vs), volley.steps);
  }

  /** Pays a player extras, notes them for the round's report and shows them at `at`; returns what they paid. */
  private payBonuses(player: number, bonuses: Bonus[], at: { x: number; y: number }): number {
    const points = bonuses.reduce((sum, b) => sum + b.points, 0);
    this.players[player].score += points;
    this.record((book) => book.bonuses.push(...bonuses.map((b) => ({ player, ...b }))));
    this.emit({ type: 'bonus', player, bonuses, x: at.x, y: at.y });
    return points;
  }

  /** The extra the end of a round pays: the survivor won it from alone in last place at its start. */
  private roundBonuses(survivor: number | null): void {
    if (!this.paysKillBonuses || this.forfeited || survivor === null) return;
    if (this.ledger.comebackCandidate() === survivor) {
      this.payBonuses(survivor, [{ kind: 'comeback', points: SCORING.COMEBACK * this.payFactor }], this.world.ships[survivor]);
    }
  }

  // ————————————————————————————— Marks on the cards —————————————————————————————

  /**
   * Whose point of view the cards take: the seat at this screen, the one person at a table of CPUs,
   * whoever is on turn at a shared keyboard — and nobody's for the stands.
   */
  get markViewer(): number | null {
    if (this.spectating) return null;
    if (this.viewer !== null) return this.viewer;
    const humans = this.players.filter((p) => !p.cpu && !p.left);
    if (humans.length === 1) return humans[0].id;
    const focus = this.focus;
    return focus >= 0 && !this.players[focus].cpu ? focus : null;
  }

  /**
   * The marks on every card (by ship) for the person at this screen, while the aim is being set: what a kill of that ship would pay them
   * beyond its points, a comeback it is in line for, and on their own card what any kill of theirs would pay now. Worked out on each call:
   * read it once a frame.
   */
  get cardMarks(): Mark[][] {
    return this.ledger.marksFor(this.markViewer);
  }

  /** What the finished shots tell the scorecard: how far they flew and whom they narrowly missed. */
  private recordFlights(volley: Volley): void {
    for (const vs of volley.shots) {
      if (vs.stray) continue;
      const trail = vs.trail;
      const end = { x: trail[trail.length - 2], y: trail[trail.length - 1] };
      this.record((book) => (book.longestShot = improve(book.longestShot, vs.owner, pathLength(trail), true, { trail, at: end })));
      // Enemy ships still flying after the volley — the ones this shot missed.
      const friends = this.friendsOf(vs.owner);
      let nearest: { id: number; gap: number } | null = null;
      volley.world.ships.forEach((ship, id) => {
        if (id === vs.owner || friends.includes(id) || !ship.alive) return;
        const { distance, at } = closestApproach(trail, ship);
        const gap = distance - PHYSICS.SHIP_RADIUS;
        if (gap > 0) this.record((book) => (book.closeCall = improve(book.closeCall, vs.owner, gap, false, { trail, at })));
        if (gap > 0 && gap < NEAR_MISS_GAP && (!nearest || gap < nearest.gap)) nearest = { id, gap };
      });
      if (nearest) this.cue('nearMiss', vs.owner, (nearest as { id: number }).id);
    }
  }

  /** Note something for the scorecard, in both the round's and the match's books. */
  private record(update: (book: StatBook) => void): void {
    update(this.roundStats);
    update(this.matchStats);
  }

  protected recordKill(record: KillRecord): void {
    this.killFeed.push(record);
    if (this.killFeed.length > 8) this.killFeed.shift();
    this.lastKill = record;
    this.emit({ type: 'kill', record });
  }

  /** Whether the round ends without a winner even though somebody is still in it (sudden death decided it, not a player). */
  protected get noWinner(): boolean {
    return false;
  }

  protected endRound(): void {
    // A pending vote cannot change a round after its normal result has been recorded.
    this.skipVoting.clear();
    // Away ships keep a round open, but do not win it if everybody present is eliminated.
    const alive = this.noWinner ? [] : this.players.filter((p) => p.alive && !p.away && !p.left);
    const survivor = alive.length === 1 ? alive[0].id : null;
    // In team mode the whole winning team shares the bonus — fallen members included.
    const team = this.teamMode && alive.length > 0 && this.decided ? alive[0].team : null;
    const bonus = team !== null || survivor !== null ? this.survivorBonus * this.payFactor : 0;
    if (team !== null) {
      for (const p of this.players) if (p.team === team) p.score += bonus;
    } else if (survivor !== null) {
      this.players[survivor].score += bonus;
    }
    this.roundBonuses(survivor);
    const title = team !== null ? 'teamWin' : this.forfeited ? 'forfeit' : this.roundTitle(survivor);
    this.summary = { title, survivor, team, bonus, lastKill: this.lastKill };
    // The oracle's question for the whole round: a lone survivor or a whole team won it, or nobody did.
    const winners = team !== null ? this.players.filter((p) => p.team === team).map((p) => p.id) : survivor !== null ? [survivor] : [];
    this.oracle.resolveRound(winners, this.round, this.clock);
    this.stands.resolveRound(winners, this.round, this.clock);
    // What the bets on the round come to: their share of the pot goes into the winners' purses.
    for (const tip of this.oracle.roundResult?.tips ?? []) if (tip.payout) this.payInto(tip.player, tip.payout, false);
    for (const tip of this.stands.roundResult?.tips ?? []) if (tip.payout) this.payInto(tip.player, tip.payout, true);
    this.scoreHistory.push(this.players.map((p) => p.score));
    if (this.mayhem) this.mayhemHistory.push(this.mayhem);
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
    this.showRoundKillcam();
  }

  // ————————————————————————————— CPU —————————————————————————————

  /** A CPU lays the placement it holds, at the spot its aim points at. False when it cannot lay it now. */
  protected placeForCpu(id: number): boolean {
    return this.power.placeForCpu(id, this.salvo);
  }

  protected setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'aiming') {
      this.parkAway();
      this.openRoundQuestion();
    }
  }

  protected emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }
}
