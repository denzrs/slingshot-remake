import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './daily-gallery.css';

import { devHref } from './dev-shell';
import { fmtInt, getLang, isLang, setLang, t, type Key } from '../platform/i18n';
import {
  ALL_THEMES,
  baselineScore,
  buildSector,
  challengeNumber,
  dailyChallenge,
  dateKey,
  isDateKey,
  modifiersOf,
  sectorRules,
  shiftDate,
  weekday,
  type Modifier,
  type Sector,
} from '../sim/challenge';
import { CHALLENGE, FIELD } from '../sim/config';
import { Shot } from '../sim/physics';

function h<K extends keyof HTMLElementTagNameMap>(
  tagAndClass: string,
  attrs?: Record<string, string | boolean | number | undefined | null> | null,
  ...children: (Node | string | number | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = tagAndClass.split('.');
  const el = document.createElement(tag || 'div') as HTMLElementTagNameMap[K];
  for (const c of classes) if (c) el.classList.add(c);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null && value !== false) {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) {
      el.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    }
  }
  return el;
}

function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

function weekdayName(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang(), { weekday: 'long' }).format(new Date(y, m - 1, d));
}

const WEEKDAY_TILT_NAMES: Record<number, string> = {
  '-1': 'Gentle / Sanft (-1)',
  '0': 'Standard (0)',
  '1': 'Spicy / Anspruchsvoll (+1)',
};

const WEEKDAY_TILT = [-1, -1, 0, 0, 0, 1, 1];

const searchParams = new URLSearchParams(location.search);
const requestedLang = searchParams.get('lang');
if (isLang(requestedLang)) setLang(requestedLang);

const paramDay = searchParams.get('daily') ?? searchParams.get('date');
let selectedKey: string = isDateKey(paramDay) ? paramDay : dateKey();
let themeFilter: string = searchParams.get('theme') ?? 'all';
let showSolutions = true;

const root = h('main.daily-gallery');
document.body.append(root);

function drawSectorCanvas(canvas: HTMLCanvasElement, sector: Sector, withSolutions: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const scale = cw / FIELD.width;

  ctx.clearRect(0, 0, cw, ch);

  // Background
  const bgGrad = ctx.createRadialGradient(cw / 2, ch / 2, 20, cw / 2, ch / 2, cw / 1.5);
  bgGrad.addColorStop(0, '#102444');
  bgGrad.addColorStop(1, '#071224');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, cw, ch);

  // Field Edges
  if (sector.spec.loop) {
    ctx.strokeStyle = 'rgba(100, 210, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
    ctx.setLineDash([]);
  } else if (sector.spec.bounce) {
    ctx.strokeStyle = 'rgba(255, 173, 101, 0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
  } else {
    ctx.strokeStyle = 'rgba(91, 125, 179, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
  }

  // Nebulae
  for (const n of sector.world.nebulae ?? []) {
    const ng = ctx.createRadialGradient(n.x * scale, n.y * scale, 0, n.x * scale, n.y * scale, n.radius * scale);
    ng.addColorStop(0, 'rgba(140, 90, 220, 0.28)');
    ng.addColorStop(0.6, 'rgba(90, 160, 240, 0.14)');
    ng.addColorStop(1, 'rgba(90, 160, 240, 0)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(n.x * scale, n.y * scale, n.radius * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Black Holes
  for (const bh of sector.world.holes ?? []) {
    const bhg = ctx.createRadialGradient(bh.x * scale, bh.y * scale, bh.radius * scale * 0.8, bh.x * scale, bh.y * scale, bh.radius * scale * 2.2);
    bhg.addColorStop(0, 'rgba(255, 120, 60, 0.7)');
    bhg.addColorStop(0.5, 'rgba(180, 50, 150, 0.3)');
    bhg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bhg;
    ctx.beginPath();
    ctx.arc(bh.x * scale, bh.y * scale, bh.radius * scale * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(bh.x * scale, bh.y * scale, bh.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Planets
  for (const p of sector.world.planets) {
    const px = p.x * scale;
    const py = p.y * scale;
    const pr = Math.max(3, p.radius * scale);

    // Atmosphere
    ctx.fillStyle = 'rgba(91, 125, 179, 0.15)';
    ctx.beginPath();
    ctx.arc(px, py, pr + 3, 0, Math.PI * 2);
    ctx.fill();

    // Planet body
    ctx.fillStyle = p.tint || '#5b7db3';
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 228, 216, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Defenses (Flak Cannons)
  for (const f of sector.world.defenses ?? []) {
    ctx.strokeStyle = '#e56d80';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(f.x * scale, f.y * scale, Math.max(4, f.radius * scale * 0.4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Player ship
  const player = sector.world.ships[0];
  if (player) {
    const sx = player.x * scale;
    const sy = player.y * scale;
    ctx.fillStyle = '#64d2ff';
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Target drones
  for (let i = 1; i < sector.world.ships.length; i++) {
    const drone = sector.world.ships[i];
    const dx = drone.x * scale;
    const dy = drone.y * scale;
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e56d80';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 210, 122, 0.6)';
    ctx.beginPath();
    ctx.moveTo(dx - 5, dy); ctx.lineTo(dx + 5, dy);
    ctx.moveTo(dx, dy - 5); ctx.lineTo(dx, dy + 5);
    ctx.stroke();
  }

  // Solution Trajectories
  if (withSolutions && sector.solutions.length > 0) {
    for (const sol of sector.solutions) {
      const shot = new Shot(
        sector.world,
        0,
        sol.angle,
        sol.power,
        sectorRules(sector.spec),
        false,
        [],
        false,
        sector.spec.ammo === 'plasma',
      );

      ctx.beginPath();
      ctx.moveTo(shot.x * scale, shot.y * scale);
      let steps = 0;
      while (!shot.end && steps < 1200) {
        shot.step();
        ctx.lineTo(shot.x * scale, shot.y * scale);
        steps++;
      }
      ctx.strokeStyle = sol.blocked ? 'rgba(255, 173, 101, 0.85)' : 'rgba(110, 227, 200, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function findAdjacentChallenge(fromKey: string, delta: number, requiredTheme: string): string {
  if (requiredTheme === 'all') return shiftDate(fromKey, delta);
  let cur = fromKey;
  for (let i = 0; i < 365; i++) {
    cur = shiftDate(cur, delta);
    const ch = dailyChallenge(cur);
    if (ch.theme === requiredTheme) return cur;
  }
  return shiftDate(fromKey, delta);
}

function render(): void {
  document.documentElement.lang = getLang();
  document.title = `Slingshot — ${t('gallery.daily.title')} (dev)`;

  const challenge = dailyChallenge(selectedKey);
  const totalTargets = challenge.sectors.reduce((sum, s) => sum + s.targets, 0);
  const totalShots = challenge.sectors.reduce((sum, s) => sum + s.shots, 0);
  const tilt = WEEKDAY_TILT[weekday(selectedKey)];
  const tiltName = WEEKDAY_TILT_NAMES[tilt] ?? String(tilt);

  root.replaceChildren();

  // Header
  const head = h('header', null,
    h('p.daily-gallery__eyebrow', null, 'SLINGSHOT / DEV / DAILY CHALLENGES'),
    h('h1', null, t('gallery.daily.title')),
    h('p.daily-gallery__intro', null, t('gallery.daily.intro')),
  );

  // Sticky Toolbar
  const dateInput = h('input', { type: 'date', value: selectedKey }) as HTMLInputElement;
  dateInput.addEventListener('change', () => {
    if (isDateKey(dateInput.value)) {
      selectedKey = dateInput.value;
      updateUrl();
      render();
    }
  });

  const jumpInput = h('input', { type: 'number', min: '1', max: '9999', value: String(challenge.number) }) as HTMLInputElement;
  jumpInput.addEventListener('change', () => {
    const num = parseInt(jumpInput.value, 10);
    if (Number.isFinite(num) && num >= 1) {
      selectedKey = shiftDate(CHALLENGE.EPOCH, num - 1);
      updateUrl();
      render();
    }
  });

  const prevBtn = h('button', { type: 'button' }, t('gallery.daily.prev'));
  prevBtn.addEventListener('click', () => {
    selectedKey = findAdjacentChallenge(selectedKey, -1, themeFilter);
    updateUrl();
    render();
  });

  const todayBtn = h('button.is-primary', { type: 'button' }, t('gallery.daily.today'));
  todayBtn.addEventListener('click', () => {
    selectedKey = dateKey();
    updateUrl();
    render();
  });

  const nextBtn = h('button', { type: 'button' }, t('gallery.daily.next'));
  nextBtn.addEventListener('click', () => {
    selectedKey = findAdjacentChallenge(selectedKey, 1, themeFilter);
    updateUrl();
    render();
  });

  const themeSelect = h('select', null,
    h('option', { value: 'all', selected: themeFilter === 'all' }, t('gallery.daily.allThemes')),
    ...ALL_THEMES.map((th) => h('option', { value: th, selected: themeFilter === th }, t(`daily.theme.${th}`))),
  ) as HTMLSelectElement;
  themeSelect.addEventListener('change', () => {
    themeFilter = themeSelect.value;
    updateUrl();
    render();
  });

  const toggleSol = h('label.daily-gallery__check', null,
    h('input', { type: 'checkbox', checked: showSolutions }),
    h('span', null, t('gallery.daily.toggleSolutions')),
  ) as HTMLLabelElement;
  toggleSol.querySelector('input')!.addEventListener('change', (e) => {
    showSolutions = (e.target as HTMLInputElement).checked;
    render();
  });

  const milestone = (label: string, day: string) => {
    const btn = h('button.daily-gallery__milestone-btn', { type: 'button' }, label);
    btn.addEventListener('click', () => {
      selectedKey = day;
      updateUrl();
      render();
    });
    return btn;
  };

  const milestonesBar = h('div.daily-gallery__milestones', null,
    h('span', null, `${t('gallery.daily.milestones')}:`),
    milestone(`Epoch #1 (${CHALLENGE.EPOCH})`, CHALLENGE.EPOCH),
    milestone('Varianten #21 (2026-10-22)', '2026-10-22'),
    milestone('Expanded #24 (2026-10-25)', '2026-10-25'),
    milestone('Anomalien #38 (2026-11-08)', '2026-11-08'),
    milestone('Loop Themes #41 (2026-11-11)', '2026-11-11'),
    milestone(`Heute #${challengeNumber(dateKey())} (${dateKey()})`, dateKey()),
  );

  const toolbar = h('div.daily-gallery__toolbar', null,
    h('div.daily-gallery__nav-group', null, prevBtn, todayBtn, nextBtn),
    h('label.daily-gallery__field', null,
      h('span', null, t('gallery.daily.date')),
      dateInput,
    ),
    h('label.daily-gallery__field', null,
      h('span', null, t('gallery.daily.jump')),
      jumpInput,
    ),
    h('label.daily-gallery__field', null,
      h('span', null, t('gallery.daily.theme')),
      themeSelect,
    ),
    toggleSol,
    milestonesBar,
  );

  // Showcase Hero Card
  const playUrl = devHref(`/?daily=${selectedKey}&start=1`);
  const briefingUrl = devHref(`/?daily=${selectedKey}`);
  const introText = challenge.theme === 'precision' ? '' : t(`daily.theme.${challenge.theme}.text`);

  const showcase = h('section.daily-showcase', null,
    h('div.daily-showcase__head', null,
      h('div.daily-showcase__titles', null,
        h('div.daily-showcase__title-row', null,
          h('h2', null, `#${challenge.number} — ${t(`daily.theme.${challenge.theme}`)}`),
          h('span.daily-showcase__date', null, `${formatDay(selectedKey)} (${weekdayName(selectedKey)})`),
        ),
        introText ? h('p.daily-showcase__intro', null, introText) : null,
      ),
      h('div.daily-showcase__actions', null,
        h('span.daily-showcase__theme-tag', null, t(`daily.theme.${challenge.theme}`)),
        h('a.daily-btn.daily-btn--play', { href: playUrl }, `🚀 ${t('gallery.daily.play')}`),
        h('a.daily-btn', { href: briefingUrl }, `📋 ${t('gallery.daily.briefing')}`),
      ),
    ),
    h('dl.daily-showcase__metrics', null,
      h('div.daily-metric', null,
        h('dt', null, t('gallery.daily.baseline')),
        h('dd.is-accent', null, fmtInt(baselineScore(challenge))),
      ),
      h('div.daily-metric', null,
        h('dt', null, t('gallery.daily.clearBonus')),
        h('dd', null, `+${fmtInt(CHALLENGE.CLEAR_BONUS)} / Sektor`),
      ),
      h('div.daily-metric', null,
        h('dt', null, t('gallery.daily.totalTargets')),
        h('dd.is-cyan', null, String(totalTargets)),
      ),
      h('div.daily-metric', null,
        h('dt', null, t('gallery.daily.totalShots')),
        h('dd', null, String(totalShots)),
      ),
      h('div.daily-metric', null,
        h('dt', null, t('gallery.daily.weekdayTilt')),
        h('dd', null, tiltName),
      ),
    ),
  );

  // 5 Sectors Grid
  const sectorsGrid = h('div.daily-sectors-grid');
  for (const spec of challenge.sectors) {
    const sector = buildSector(spec);
    const modifiers = modifiersOf(spec);

    const canvas = h('canvas.sector-card__canvas', { width: '320', height: '200' }) as HTMLCanvasElement;
    drawSectorCanvas(canvas, sector, showSolutions);

    const badges = h('div.sector-card__badges', null,
      ...modifiers.map((m: Modifier) => {
        const isLoop = m === 'loop';
        const isBounce = m === 'bounce';
        const isAnomaly = ['pinball', 'white_hole', 'instability'].includes(m);
        const cls = isLoop ? '.sector-badge--loop' : isBounce ? '.sector-badge--bounce' : isAnomaly ? '.sector-badge--anomaly' : '';
        return h(`span.sector-badge${cls}`, null, t(`daily.mod.${m}` as Key));
      }),
    );

    const aimUrl = devHref(`/dev/aim.html?seed=${spec.seed}&edges=${spec.loop ? 'loop' : spec.bounce ? 'wall' : 'void'}&shotTime=${spec.flightTime ?? 15}`);

    const stars = '★'.repeat(spec.difficulty) + '☆'.repeat(5 - spec.difficulty);

    const solutionEl = sector.solutions.length > 0 ? h('div.sector-card__solution', null,
      h('p.sector-card__solution-title', null, t('gallery.daily.solution')),
      ...sector.solutions.map((sol) => {
        const blockedText = sol.blocked ? t('gallery.daily.solutionBlocked') : t('gallery.daily.solutionDirect');
        return h('p.sector-card__solution-details', null,
          `Drone #${sol.target}: `,
          t('gallery.daily.solutionHint', {
            angle: sol.angle.toFixed(1),
            power: Math.round(sol.power),
            window: sol.window.toFixed(2),
            blocked: blockedText,
          }),
        );
      }),
    ) : null;

    const cardClasses = [
      'sector-card',
      spec.loop ? 'has-loop' : '',
      spec.bounce ? 'has-bounce' : '',
      spec.anomalies?.length ? 'has-anomalies' : '',
    ].filter(Boolean).join('.');

    const card = h(`article.${cardClasses}`, null,
      h('div.sector-card__preview', null, canvas),
      h('div.sector-card__body', null,
        h('div.sector-card__head', null,
          h('h4.sector-card__title', null, t('gallery.daily.sectorNum', { n: spec.index + 1 })),
          h('span.sector-card__difficulty', { title: `${t('gallery.daily.difficulty')} ${spec.difficulty}/5` }, stars),
        ),
        badges,
        h('dl.sector-card__stats', null,
          h('dt', null, t('gallery.daily.totalTargets')),
          h('dd', null, String(spec.targets)),
          h('dt', null, t('gallery.daily.totalShots')),
          h('dd', null, String(spec.shots)),
          h('dt', null, t('gallery.daily.flightTime')),
          h('dd', null, `${spec.flightTime ?? CHALLENGE.FLIGHT_TIME}s`),
          h('dt', null, t('gallery.daily.gravity')),
          h('dd', null, `${spec.gravity.toFixed(1)}x`),
          h('dt', null, t('gallery.daily.edges')),
          h('dd', null, spec.loop ? 'Loop' : spec.bounce ? 'Wall' : 'Void'),
          h('dt', null, 'Seed'),
          h('dd', null, String(spec.seed)),
        ),
        ...(solutionEl ? [solutionEl] : []),
        h('div.sector-card__actions', null,
          h('a', { href: aimUrl }, `🎯 ${t('gallery.daily.aimSector')} ↗`),
        ),
      ),
    );

    sectorsGrid.append(card);
  }

  // Schedule Timeline
  const scheduleRows: HTMLElement[] = [];
  const scheduleStart = shiftDate(selectedKey, -5);
  for (let i = 0; i < 21; i++) {
    const dayKey = shiftDate(scheduleStart, i);
    const dayCh = dailyChallenge(dayKey);
    if (themeFilter !== 'all' && dayCh.theme !== themeFilter) continue;

    const isCurrent = dayKey === selectedKey;
    const isToday = dayKey === dateKey();

    const row = h(`tr${isCurrent ? '.is-selected' : ''}${isToday ? '.is-today' : ''}`, null,
      h('td', null, formatDay(dayKey)),
      h('td', null, `#${dayCh.number}`),
      h('td', null, weekdayName(dayKey)),
      h('td', null, t(`daily.theme.${dayCh.theme}`)),
      h('td', null,
        h('button.schedule-btn', { type: 'button' }, t('gallery.daily.view')),
      ),
      h('td', null,
        h('a.schedule-btn', { href: devHref(`/?daily=${dayKey}&start=1`) }, '🚀'),
      ),
    );

    row.querySelector('button')!.addEventListener('click', () => {
      selectedKey = dayKey;
      updateUrl();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    scheduleRows.push(row);
  }

  const scheduleTable = h('section.daily-schedule', null,
    h('div.daily-schedule__head', null,
      h('h3', null, t('gallery.daily.schedule')),
      h('p', null, t('gallery.daily.scheduleIntro')),
    ),
    h('div.daily-schedule__table-wrap', null,
      h('table.daily-schedule__table', null,
        h('thead', null,
          h('tr', null,
            h('th', null, t('gallery.daily.date')),
            h('th', null, '#'),
            h('th', null, 'Tag'),
            h('th', null, t('gallery.daily.theme')),
            h('th', null, ''),
            h('th', null, ''),
          ),
        ),
        h('tbody', null, ...scheduleRows),
      ),
    ),
  );

  root.append(
    head,
    toolbar,
    showcase,
    h('div.daily-sectors-heading', null,
      h('h3', null, t('gallery.daily.sectors')),
    ),
    sectorsGrid,
    scheduleTable,
  );
}

function updateUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('daily', selectedKey);
  if (themeFilter !== 'all') url.searchParams.set('theme', themeFilter);
  else url.searchParams.delete('theme');
  history.replaceState(null, '', url.toString());
}

render();
