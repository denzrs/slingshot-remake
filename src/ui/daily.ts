import { dailyChallenge, dateKey, modifiersOf } from '../challenge';
import { loadDay, loadStreak, type RunOutcome } from '../dailyStore';
import type { ChallengeMatch, SectorResult, ShotLog } from '../game';
import { fmtInt, getLang, t, tn, type Key } from '../i18n';
import { h, type MenuItem, type Screen } from './menu';
import { leaderboardAvailable, leaderboardScreen } from './leaderboard';
import type { App } from './screens';
import { menuPage } from './menu-page';
import { modeArt } from './mode-icons';

/** "Fri, 2 October 2026" in the UI language. */
function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

const themeName = (theme: string) => t(`daily.theme.${theme}` as Key);

/** The one-line hint under the title-menu entry. */
export function dailyMenuHint(key: string): string {
  const challenge = dailyChallenge(key);
  const params = { n: challenge.number, theme: themeName(challenge.theme) };
  const day = loadDay(key);
  return day ? t('daily.menuHintBest', { ...params, score: fmtInt(day.best) }) : t('daily.menuHint', params);
}

/** "hh:mm" until the local midnight that rolls the challenge over. */
function untilMidnight(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// ————————————————————————————— Briefing —————————————————————————————

/** Today's challenge at a glance: theme, the five sectors and how hard each one is, your best so far. */
export function dailyScreen(app: App): Screen {
  const key = app.today();
  const challenge = dailyChallenge(key);
  const day = loadDay(key);
  const streak = loadStreak(key);

  let selected = 0;
  const detail = h('div.mission-detail', { 'aria-live': 'polite' });
  const update = () => {
    const spec = challenge.sectors[selected];
    detail.replaceChildren(
      h('div', null,
        h('strong', null, t('flow.sectorDetails', { n: selected + 1, difficulty: spec.difficulty })),
        h('span', null, `${tn('daily.targets', spec.targets)} · ${tn('daily.shots', spec.shots)}`),
      ),
      h('span.chips', null, ...modifiersOf(spec).map((m) => h('span.chip', null, t(`daily.mod.${m}` as Key)))),
    );
  };
  const stat = (label: string, value: string) => h('div', null, h('dt', null, label), h('dd', null, value));
  const hasBoard = leaderboardAvailable();
  return {
    build: () => {
      const stats = h('dl.mission-stats', null,
        stat(t('daily.stats.best'), day ? fmtInt(day.best) : '—'),
        stat(t('daily.stats.attempts'), String(day?.attempts ?? 0)),
        stat(t('daily.stats.streak'), streak ? tn('daily.days', streak) : '—'),
      );
      const root = menuPage({
        title: themeName(challenge.theme), eyebrow: `${t('daily.eyebrow', { n: challenge.number })} · ${formatDay(key)}`,
        intro: t(`daily.theme.${challenge.theme}.text` as Key), className: 'menu-page--mission',
        body: [
          h('h3.setup__title', null, t('shell.sectors')),
          h('div.items.items--row.mission-route', { 'data-section': 'route' }), detail,
          h('div.mission-bottom', null, stats,
            h('details.mission-rules', null, h('summary', null, t('flow.missionDetails')), h('p.note', null, t('daily.rules'))),
          ),
          ...(key === dateKey() ? [h('p.daily-reset', null, t('daily.resets', { time: untilMidnight() }))] : []),
        ],
      });
      root.querySelector('.menu-page__head')!.append(h('div.mission-art', null, modeArt(challenge.theme === 'singularity' ? 'horizon' : 'daily')));
      return root;
    },
    items: [
      ...challenge.sectors.map((spec): MenuItem => ({
        kind: 'action', section: 'route', label: t('daily.sector', { n: spec.index + 1 }),
        tag: `${'●'.repeat(spec.difficulty)}${'○'.repeat(5 - spec.difficulty)}`,
        hint: `${tn('daily.targets', spec.targets)} · ${tn('daily.shots', spec.shots)}`,
        selected: () => selected === spec.index,
        run: () => { selected = spec.index; app.menu.refresh(); },
      })),
      { kind: 'action', label: t('common.back'), run: () => app.menu.back() },
      ...(hasBoard ? [{ kind: 'action', label: t('daily.board.view'), run: () => app.menu.push(() => leaderboardScreen(app, key, formatDay(key), null)) } satisfies MenuItem] : []),
      { kind: 'action', label: t('daily.start'), primary: true, run: () => app.startDaily() },
    ],
    focus: challenge.sectors.length + (hasBoard ? 2 : 1),
    update,
  };
}

// ————————————————————————————— Result —————————————————————————————

type Glyph = 'trick' | 'hit' | 'miss' | 'self';

const glyphOf = (s: ShotLog): Glyph => (s.kind === 'hit' ? (s.combo.length ? 'trick' : 'hit') : s.kind);
const EMOJI: Record<Glyph, string> = { trick: '🟨', hit: '🟩', miss: '⬛', self: '🟥' };

/** Wordle-style text: score, rank and one row of coloured squares per sector. */
export function shareText(match: ChallengeMatch): string {
  const r = match.result();
  const rows = r.sectors.map((s) => `${s.index + 1} ${s.shots.map((x) => EMOJI[glyphOf(x)]).join('')}${s.cleared ? '' : ' ✕'}`);
  return [
    t('daily.share.header', { n: r.number, date: formatDay(r.dateKey) }),
    themeName(r.theme),
    t('daily.share.score', { score: fmtInt(r.total), rank: t(`daily.rank.${r.rank}` as Key) }),
    ...rows,
  ].join('\n');
}

function sectorLine(s: SectorResult): HTMLElement {
  const squares = s.shots.map((x) => h(`span.shot.shot--${glyphOf(x)}`, null));
  // Unused shots stay as hollow squares, so the budget reads at a glance.
  const unused = Array.from({ length: Math.max(0, s.budget - s.shots.length) }, () => h('span.shot.shot--unused', null));
  const points = s.points < 0 ? `−${fmtInt(-s.points)}` : s.points > 0 ? `+${fmtInt(s.points)}` : '0';
  return h(
    'li',
    s.cleared ? null : { class: 'is-failed' },
    h('span.sectors__n', null, t('daily.sector', { n: s.index + 1 })),
    h('span.shots', null, ...squares, ...unused),
    h('span.sectors__points', null, s.cleared ? points : `✕ ${points}`),
  );
}

/**
 * The end-of-run card, laid out to be screenshotted: date, score, rank and the five sectors,
 * with the buttons underneath so a crop of the card stays clean.
 */
export function dailyResultScreen(app: App, match: ChallengeMatch, outcome: RunOutcome): Screen {
  const result = match.result();
  let status: HTMLElement | null = null;

  const copy = async () => {
    let message: Key = 'daily.result.copied';
    try {
      await navigator.clipboard.writeText(shareText(match));
    } catch {
      message = 'daily.result.copyFailed';
    }
    if (status) status.textContent = t(message);
  };

  return {
    build: () => {
      const meta = [
        `${t('daily.result.best')} ${fmtInt(outcome.record.best)}`,
        ...(outcome.streak > 1 ? [`${t('daily.result.streak')} ${tn('daily.days', outcome.streak)}`] : []),
        t('daily.result.attempt', { n: outcome.record.attempts }),
      ].join('  ·  ');
      const legend = h(
        'p.legend',
        null,
        ...(['hit', 'trick', 'miss', 'self'] as const).map((g) => h('span.legend__entry', null,
          h(`span.shot.shot--${g}`, { 'aria-hidden': 'true' }),
          t(({ hit: 'daily.result.legend', trick: 'daily.result.legendTrick', miss: 'daily.result.legendMiss', self: 'daily.result.legendSelf' } as const)[g]),
        )),
      );
      status = h('p.daily__status', { role: 'status' }, '');
      return menuPage({
        title: `#${result.number} · ${themeName(result.theme)}`, eyebrow: t('daily.result.eyebrow'), intro: formatDay(result.dateKey), className: 'menu-page--daily-result.menu-page--mission-result',
        body: [
          h('p.daily__score', null, h('span.daily__num', null, fmtInt(result.total)), h('span.daily__unit', null, t('daily.result.points'))),
          h('p.daily__rank', { 'data-rank': String(result.rank) }, t(`daily.rank.${result.rank}` as Key)),
          h('ol.mission-scorecards', null, ...result.sectors.map(sectorLine)),
          legend,
          h('p.daily__meta', null, meta, outcome.newBest ? h('strong.daily__new', null, `  ${t('daily.result.newBest')}`) : ''), status,
        ],

      });
    },
    items: [
      // The board is opt-in: the run goes up only if the player asks for it, and then under a name.
      ...(leaderboardAvailable()
        ? [
            {
              kind: 'action',
              label: t('daily.board.add'),
              run: () => app.menu.push(() => leaderboardScreen(app, result.dateKey, t('daily.board.yourRun', { score: fmtInt(result.total) }), result.total)),
            } satisfies MenuItem,
          ]
        : []),
      { kind: 'action', label: t('daily.retry'), primary: true, run: () => app.rematch() },
      { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
      { kind: 'action', label: t('daily.result.copy'), run: () => void copy() },
    ] satisfies MenuItem[],
    focus: leaderboardAvailable() ? 1 : 0,
    onEscape: () => app.toTitle(),
  };
}
