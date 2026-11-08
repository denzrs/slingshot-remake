import { ANOMALIES, CHALLENGE, COLORS, HORIZON, SCORING, type Anomaly } from '../../sim/config';
import { fmtNum, t } from '../../platform/i18n';
import type { StyleKind } from '../../sim/physics';
import type { PowerUpKind } from '../../sim/powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../../render/powerup-art';
import { ANOMALY_COLORS, drawAnomalySymbol } from '../../render/anomaly-art';
import { MARK_COLORS } from '../../render/mark-art';
import type { MarkKind } from '../../game';
import { STYLE_MULTIPLIER, styleLabel } from '../../sim/scoring';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { MARK_KINDS, markName } from '../../game/markLegend';
import { markIcon } from '../../render/mark-art';
import { markText } from './mark-help';
import { installNote } from '../menu/pwa-banner';
import { mountTutorialPreview, type TutorialPreviewKind } from './tutorial-preview';
import type { App } from './app';

/** One page of the tutorial: a heading and what goes under it. */
interface Lesson {
  title: string;
  /** The miniature scene beside the text, or none: the page is text and a selection only. */
  demo: TutorialPreviewKind | null;
  body: (Node | string)[];
  powerUps?: readonly PowerUpKind[];
  marks?: readonly MarkKind[];
  tricks?: readonly StyleKind[];
  anomalies?: readonly Anomaly[];
}

const kbd = (k: string) => h('kbd', null, k);

const para = (text: string) => h('p', null, text);

const keyRow = (keys: (Node | string)[], text: string) => h('tr', null, h('th', { scope: 'row' }, ...keys), h('td', null, text));

const keysTable = (...rows: HTMLElement[]) => h('table.keys-table', null, h('tbody', null, ...rows));

/** The kind's symbol, drawn small on a canvas in its own colour, for the power-up legend. */
function powerIcon(kind: PowerUpKind): HTMLCanvasElement {
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const size = 22;
  const icon = h('canvas.power-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = icon.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = ctx.fillStyle = POWER_UP_COLORS[kind];
    ctx.lineWidth = 1.8;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawPowerUpSymbol(ctx, kind, 0, 0, size * 0.34);
  }
  return icon;
}

/** A small line symbol for each trick-shot selector. */
function trickIcon(kind: StyleKind): HTMLCanvasElement {
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const size = 22;
  const icon = h('canvas.trick-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = icon.getContext('2d');
  if (!ctx) return icon;
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = COLORS.sodium;
  ctx.fillStyle = COLORS.sodium;
  ctx.lineWidth = 1.6;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (kind === 'swingby') {
    ctx.beginPath(); ctx.arc(15, 14, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 19); ctx.quadraticCurveTo(7, 20, 9, 15); ctx.quadraticCurveTo(11, 8, 17, 9); ctx.stroke();
  } else if (kind === 'bank') {
    ctx.beginPath(); ctx.moveTo(2, 18); ctx.lineTo(16, 4); ctx.lineTo(20, 8); ctx.lineTo(8, 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, 4); ctx.lineTo(20, 4); ctx.lineTo(20, 10); ctx.stroke();
  } else if (kind === 'graze') {
    ctx.beginPath(); ctx.arc(14, 16, 5, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 9); ctx.lineTo(20, 9); ctx.stroke();
  } else if (kind === 'photon') {
    ctx.beginPath(); ctx.arc(11, 11, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(11, 11, 9, 5, -0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(19, 6, 1.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(1, 17); ctx.bezierCurveTo(7, 15, 9, 6, 16, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(17, 16, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 16); ctx.lineTo(17, 13); ctx.moveTo(17, 16); ctx.lineTo(19, 17); ctx.stroke();
  }
  return icon;
}

/** The anomaly's symbol, drawn on a canvas in its own colour. */
function anomalyIcon(kind: Anomaly): HTMLCanvasElement {
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const size = 22;
  const icon = h('canvas.anomaly-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = icon.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = ctx.fillStyle = ANOMALY_COLORS[kind];
    ctx.lineWidth = 1.8;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawAnomalySymbol(ctx, kind, 0, 0, 8);
  }
  return icon;
}

/** The kinds each power-up page lists: first the ones for your own shot, then the ones that go on the field. */
const POWER_PAGES: readonly [readonly PowerUpKind[], readonly PowerUpKind[]] = [
  ['preview', 'teleport', 'splitter', 'antigravity', 'piercing', 'plasma'],
  ['shield', 'blackhole', 'planetkiller', 'nebula', 'wormhole', 'defense'],
];

const TRICKS = Object.keys(STYLE_MULTIPLIER) as StyleKind[];

function keyboardAim(): HTMLElement[] {
  return [
    para(t('tutorial.aim.1')),
    keysTable(
      keyRow([kbd('←'), ' ', kbd('→')], t('tutorial.aim.rotate')),
      keyRow([kbd('↑'), ' ', kbd('↓')], t('tutorial.aim.power')),
      keyRow([kbd('Enter')], t('tutorial.aim.fire')),
    ),
    para(t('tutorial.aim.2')),
  ];
}

/** What a connected controller does, under the keyboard's keys; only shown while the browser reports a pad. */
function padAim(): HTMLElement[] {
  return [
    para(t('tutorial.pad.1')),
    keysTable(
      keyRow([kbd(t('tutorial.pad.stick')), ' ', kbd('D-Pad')], t('tutorial.pad.aim')),
      keyRow([kbd('LB'), ' ', kbd('RB')], t('tutorial.pad.steps')),
      keyRow([kbd('A')], t('tutorial.pad.fire')),
      keyRow([kbd('X')], t('tutorial.pad.power')),
      keyRow([kbd('Y')], t('tutorial.pad.skip')),
      keyRow([kbd('B'), ' ', kbd('Start')], t('tutorial.pad.pause')),
    ),
  ];
}

/** The pages of the tutorial, in order. Each one is built when it is shown, so its texts follow the language. */
export const TUTORIAL: ((touch: boolean, stick: boolean, pad?: boolean) => Lesson)[] = [
  (touch) => ({
    title: t('tutorial.welcome.title'),
    demo: null,
    body: [para(t('tutorial.welcome.1')), para(t('tutorial.welcome.2')), para(t(touch ? 'tutorial.welcome.touch' : 'tutorial.welcome.3'))],
  }),
  (touch, stick, pad = false) => ({
    title: t('tutorial.aim.title'),
    demo: 'aim',
    body: (touch ? [
      para(t(stick ? 'tutorial.aim.touchStick' : 'tutorial.aim.touchWheel')),
      h(`div.tutorial__touch-example${stick ? '.tutorial__touch-example--stick' : ''}`, { 'aria-hidden': 'true' },
        h('span.tutorial__touch-control', null, stick ? '↙ ◉ ↗' : '◔ ↻'),
        ...(stick ? [] : [h('span.tutorial__touch-control', null, '− ━●━━ +')]),
        h('span.tutorial__touch-fire', null, t('common.fire')),
      ),
      para(t('tutorial.aim.touchFire')),
      para(t('tutorial.aim.touchSettings')),
      h('details.tutorial__keyboard', null, h('summary', null, t('tutorial.keyboard.more')), ...keyboardAim()),
    ] : keyboardAim()).concat(pad ? padAim() : []),
  }),
  () => ({
    title: t('tutorial.gravity.title'),
    demo: 'gravity',
    body: [para(t('tutorial.gravity.1')), para(t('tutorial.gravity.2')), para(t('tutorial.gravity.3')), h('p.tutorial__tip', null, t('tutorial.gravity.tip'))],
  }),
  () => ({
    title: t('tutorial.marks.title'),
    demo: null,
    marks: MARK_KINDS,
    body: [para(t('tutorial.marks.1'))],
  }),
  () => ({
    title: t('tutorial.horizon.title'),
    demo: 'horizon',
    body: [
      para(t('tutorial.horizon.1', { seconds: HORIZON.SHOT_CLOCK })),
      para(t('tutorial.horizon.2')),
      para(t('tutorial.horizon.3')),
      para(t('tutorial.horizon.4', { volley: SCORING.VOLLEY_SURVIVED, orbit: SCORING.LAST_IN_ORBIT })),
    ],
  }),
  () => ({
    title: t('tutorial.solar.title'),
    demo: 'solar',
    body: [para(t('tutorial.solar.1'))],
  }),
  () => ({
    title: t('tutorial.powerups.title'),
    demo: 'powerups',
    powerUps: POWER_PAGES[0],
    body: [para(t('tutorial.powerups.1'))],
  }),
  () => ({
    title: t('tutorial.powerups.title2'),
    demo: 'powerupsField',
    powerUps: POWER_PAGES[1],
    body: [para(t('tutorial.powerups.2'))],
  }),
  () => ({
    title: t('tutorial.tricks.title'),
    demo: 'tricks',
    tricks: TRICKS,
    body: [para(t('tutorial.tricks.1'))],
  }),
  () => ({
    title: t('tutorial.daily.title'),
    demo: 'daily',
    body: [
      para(t('tutorial.daily.1')),
      para(t('tutorial.daily.2')),
      para(t('tutorial.daily.3', { bonus: CHALLENGE.CLEAR_BONUS, selfHit: SCORING.SELF_HIT })),
      para(t('tutorial.daily.4')),
    ],
  }),
  (touch) => ({
    title: t('tutorial.keys.title'),
    demo: null,
    body: [
      ...(touch ? [para(t('tutorial.keys.touch'))] : []),
      para(t('tutorial.keys.1')),
      keysTable(
        keyRow([kbd(t('common.space'))], t('tutorial.keys.space')),
        keyRow([kbd('C')], t('tutorial.keys.clip')),
        keyRow([kbd('Esc')], t('tutorial.keys.menu')),
        keyRow([kbd('F')], t('tutorial.keys.fullscreen')),
      ),
      para(t('tutorial.keys.2')),
    ],
  }),
  () => ({
    title: t('tutorial.anomalies.title'),
    demo: 'anomalies',
    anomalies: ANOMALIES,
    body: [para(t('tutorial.anomalies.1'))],
  }),
];

/**
 * How to play: chapters are selected from the sidebar or with keyboard navigation.
 * The page is kept in this closure, so a rebuild (say, after a language switch) stays on the same page.
 */
export function tutorialScreen(app: App): () => Screen {
  let page = 0;
  let chapterNav: HTMLElement | null = null;
  let selectedPowerUp: PowerUpKind = POWER_PAGES[0][0];
  let selectedTrick: StyleKind = TRICKS[0];
  let selectedMark: MarkKind = MARK_KINDS[0];
  let selectedAnomaly: Anomaly = ANOMALIES[0];
  let preview: ReturnType<typeof mountTutorialPreview> | null = null;
  return (): Screen => {
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const lessons = TUTORIAL.map((lesson) => lesson(touch, app.settings.touchControls === 'stick', app.gamepadConnected));
    const hasPreview = lessons[page].demo !== null;
    const powerUps = lessons[page].powerUps ?? [];
    const tricks = lessons[page].tricks ?? [];
    const marks = lessons[page].marks ?? [];
    const anomalies = lessons[page].anomalies ?? [];
    if (powerUps.length && !powerUps.includes(selectedPowerUp)) selectedPowerUp = powerUps[0];
    if (tricks.length && !tricks.includes(selectedTrick)) selectedTrick = tricks[0];
    if (marks.length && !marks.includes(selectedMark)) selectedMark = marks[0];
    if (anomalies.length && !anomalies.includes(selectedAnomaly)) selectedAnomaly = anomalies[0];
    const canvas = hasPreview ? h('canvas.tutorial__canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement : null;
    const timeline = hasPreview ? h('input.tutorial__timeline', {
      type: 'range', min: '0', max: '1000', step: '1', value: '0',
      'aria-label': t('tutorial.preview.timeline'),
    }) as HTMLInputElement : null;
    const currentChapterNav = h('nav.items.tutorial-chapters', { 'data-section': 'chapters', 'aria-label': t('shell.chapters') });
    const currentChapterRail = h('div.tutorial-chapter-rail', { 'data-at-start': 'true', 'data-at-end': 'false' }, currentChapterNav);
    currentChapterNav.addEventListener('scroll', () => {
      const maxScroll = currentChapterNav.scrollWidth - currentChapterNav.clientWidth;
      currentChapterRail.dataset.atStart = String(currentChapterNav.scrollLeft <= 1);
      currentChapterRail.dataset.atEnd = String(currentChapterNav.scrollLeft >= maxScroll - 1);
    }, { passive: true });
    chapterNav = currentChapterNav;
    timeline?.addEventListener('input', (event) => {
      const range = event.currentTarget as HTMLInputElement;
      preview?.seek(Number(range.value) / 1000);
    });
    // The browser may offer the install (or the player may take it) while the page is open: show or drop the note then.
    const stopWatchingInstall = app.pwa.onChange(() => { if (page === 0) app.menu.rebuild(); });
    return {
      build: () => {
        const previewPanel = hasPreview && canvas && timeline ? h('section.tutorial__preview', { 'aria-label': t('tutorial.preview.aria') },
          h('div.tutorial__preview-head', null,
            h('span.tutorial__preview-label', null, t('tutorial.preview.label')),
            powerUps.length ? h('span.tutorial__preview-choice', null, t(`powerup.${selectedPowerUp}`))
              : tricks.length ? h('span.tutorial__preview-choice', null, styleLabel(selectedTrick))
              : anomalies.length ? h('span.tutorial__preview-choice', null, t(`anomaly.${selectedAnomaly}`)) : '',
          ),
          canvas,
          h('div.tutorial__transport', null,
            timeline,
            h('div.items', { 'data-section': 'preview-action' }),
          ),
        ) : null;
        if (canvas && timeline) {
          preview = mountTutorialPreview(canvas, lessons[page].demo!, (progress) => {
            timeline.value = String(Math.round(progress * 1000));
          }, powerUps.length ? selectedPowerUp : undefined, tricks.length ? selectedTrick : undefined, anomalies.length ? selectedAnomaly : undefined);
        }
        const powerContent: (Node | string)[] = powerUps.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.powerups.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'powerups', 'aria-label': t('tutorial.powerups.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, powerIcon(selectedPowerUp)),
                h('div', null,
                  h('h4', { style: `color: ${POWER_UP_COLORS[selectedPowerUp]}` }, t(`powerup.${selectedPowerUp}`)),
                  h('p', null, t(`tutorial.powerups.${selectedPowerUp}`)),
                ),
              ),
            ]
          : [];
        const trickContent: (Node | string)[] = tricks.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.tricks.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'tricks', 'aria-label': t('tutorial.tricks.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, trickIcon(selectedTrick)),
                h('div', null,
                  h('div.tutorial__selection-heading', null,
                    h('h4', null, styleLabel(selectedTrick)),
                    h('span.tutorial__selection-multiplier', null, `×${fmtNum(STYLE_MULTIPLIER[selectedTrick])}`),
                  ),
                  h('p', null, t(`style.${selectedTrick}.text`)),
                ),
              ),
            ]
          : [];
        const markContent: (Node | string)[] = marks.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.marks.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'marks', 'aria-label': t('tutorial.marks.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, markIcon(selectedMark)),
                h('div', null,
                  h('h4', { style: `color: ${MARK_COLORS[selectedMark]}` }, markName(selectedMark)),
                  h('p', null, markText(selectedMark)),
                ),
              ),
            ]
          : [];
        const anomalyContent: (Node | string)[] = anomalies.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.anomalies.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'anomalies', 'aria-label': t('tutorial.anomalies.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, anomalyIcon(selectedAnomaly)),
                h('div', null,
                  h('h4', { style: `color: ${ANOMALY_COLORS[selectedAnomaly]}` }, t(`anomaly.${selectedAnomaly}`)),
                  h('p', null, t(`anomaly.${selectedAnomaly}.hint`)),
                ),
              ),
            ]
          : [];
        return menuPage({
          title: t('common.help'), eyebrow: t('shell.flightSchool'), className: 'menu-page--tutorial',
          body: [h('article.tutorial', { 'aria-live': 'polite' },
            h('h3.tutorial__title', null, lessons[page].title),
            h(`div.tutorial__layout${hasPreview ? '' : '.tutorial__layout--text-only'}`, null,
              h('div.tutorial__copy', null, ...lessons[page].body, ...(page === 0 ? [installNote(app.pwa)].filter((note) => note !== null) : []), ...powerContent, ...trickContent, ...markContent, ...anomalyContent),
              ...(previewPanel ? [previewPanel] : []),
            ),
          )],
          aside: [currentChapterRail],
          footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
        });
      },
      items: [
        ...lessons.map((lesson, i): MenuItem => ({
          kind: 'action', section: 'chapters', label: lesson.title, selected: () => page === i,
          run: () => {
            page = i;
            app.menu.rebuild();
            if (typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches) {
              chapterNav?.querySelector<HTMLElement>('.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
            }
          },
        })),
        ...powerUps.map((kind): MenuItem => ({
          kind: 'action', section: 'powerups', label: t(`powerup.${kind}`),
          icon: () => powerIcon(kind), selected: () => selectedPowerUp === kind,
          run: () => { selectedPowerUp = kind; app.menu.rebuild(); },
        })),
        ...tricks.map((kind): MenuItem => ({
          kind: 'action', section: 'tricks', label: styleLabel(kind),
          icon: () => trickIcon(kind), selected: () => selectedTrick === kind,
          run: () => { selectedTrick = kind; app.menu.rebuild(); },
        })),
        ...marks.map((kind): MenuItem => ({
          kind: 'action', section: 'marks', label: markName(kind),
          icon: () => markIcon(kind), selected: () => selectedMark === kind,
          run: () => { selectedMark = kind; app.menu.rebuild(); },
        })),
        ...anomalies.map((kind): MenuItem => ({
          kind: 'action', section: 'anomalies', label: t(`anomaly.${kind}`),
          icon: () => anomalyIcon(kind), selected: () => selectedAnomaly === kind,
          run: () => { selectedAnomaly = kind; app.menu.rebuild(); },
        })),
        ...(hasPreview ? [{ kind: 'action' as const, section: 'preview-action', label: t('tutorial.preview.replay'), run: () => { if (timeline) timeline.value = '0'; preview?.replay(); } }] : []),
        { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
      ],
      // Keep focus on this chapter so ↑/↓ navigates the lesson list.
      focus: page,
      dispose: () => {
        preview?.dispose();
        preview = null;
        stopWatchingInstall();
      },
    };
  };
}
