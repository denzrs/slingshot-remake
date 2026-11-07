import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './briefing-gallery.css';
import { createMatch, type Match } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';
import { ANOMALIES, MAYHEM, type Anomaly } from '../sim/config';
import { ANOMALY_COLORS } from '../render/anomaly-art';
import { type TwistId, type RoundTwist } from '../game/mayhem';
import { t } from '../platform/i18n';
import { Effects } from '../render/effects';
import { Renderer, type DrawOptions } from '../render/renderer';

const SEATS: Seat[] = ['human', 'human', 'medium', 'medium', 'off', 'off'];
const NAMES = ['Du', 'Mira', 'Rook', 'Nia'];

// State
const activeAnomalies = new Set<Anomaly>(['pinball']);
let activeTwists: TwistId[] = ['billiard'];
let mayhemEnabled = true;
let jackpot = false;
let finale = false;
let roundNumber = 1;
let isPlaying = false;
let currentTime = 1.4; // Landed default so twists and anomalies are fully displayed
type ViewMode = 'desktop' | 'laptop' | 'portrait';
let viewportMode: ViewMode = 'desktop';

const VIEWPORTS = {
  desktop: { w: 1200, h: 720 },
  laptop: { w: 960, h: 580 },
  portrait: { w: 390, h: 740 },
} as const;

// Create match
const baseSettings = {
  ...DEFAULT_SETTINGS,
  seats: [...SEATS],
  rounds: 5,
  menuBackground: false,
  menuSounds: false,
  gameSounds: false,
  anomalies: ['pinball'] as Anomaly[],
};

const match: Match = createMatch('classic', baseSettings, {
  seats: [...SEATS],
  names: NAMES,
  seed: 424242,
});

match.phase = 'aiming';
match.current = 0;
match.viewer = 0;

function syncMatch(): void {
  const anomalies = Array.from(activeAnomalies);
  (match as unknown as { baseSettings: { anomalies: Anomaly[] } }).baseSettings.anomalies = anomalies;
  (match as unknown as { settings: { anomalies: Anomaly[] } }).settings.anomalies = anomalies;
  const twistList: RoundTwist[] = activeTwists.map((id) => ({
    id,
    n: id === 'billiard' ? 2 : id === 'precision' ? 85 : id === 'shortBreath' ? 60 : undefined,
  }));
  match.mayhem = mayhemEnabled ? { twists: twistList, finale, jackpot } : null;
  match.round = roundNumber;
  match.anomalyAlert = anomalies.length > 0;
  match.revealHeld = true;
  match.clock = 0;
  match.revealEnd = MAYHEM.REVEAL_TIME - currentTime;
}

// Build UI
const root = document.createElement('div');
root.className = 'briefing-tool';
root.innerHTML = `
  <header>
    <h1>${t('dev.briefing')}</h1>
    <p class="desc">${t('dev.briefing.text')}</p>
  </header>

  <div class="panel">
    <div>
      <div class="section-title">Schnell-Vorlagen</div>
      <div class="presets-row">
        <button class="btn active" data-preset="pinball-billiard">Pinball + Billard (Screenshot)</button>
        <button class="btn" data-preset="extreme">Extrem: 6 Anomalien + 4 Twists</button>
        <button class="btn" data-preset="balanced">3 Anomalien + 2 Twists</button>
        <button class="btn" data-preset="anomalies-only">Nur Anomalien (4)</button>
        <button class="btn" data-preset="mayhem-only">Nur Mayhem (3 Twists)</button>
        <button class="btn" data-preset="quiet">Ruhe vor dem Sturm (0 Twists)</button>
      </div>
    </div>

    <div class="config-grid">
      <div class="config-group">
        <div class="section-title">Anomalien (${ANOMALIES.length})</div>
        <div class="chips-container" id="anomaly-chips"></div>
      </div>

      <div class="config-group">
        <div class="section-title">
          <span>Mayhem-Twists</span>
          <button class="btn active" id="toggle-mayhem" style="margin-left:auto; padding: 3px 8px; font-size: 11px;">Mayhem: AN</button>
        </div>
        <div class="chips-container" id="twist-chips"></div>
      </div>

      <div class="config-group">
        <div class="section-title">Runden-Modifikatoren</div>
        <div class="presets-row">
          <button class="btn" id="toggle-jackpot">Jackpot (2×)</button>
          <button class="btn" id="toggle-finale">Finale</button>
          <button class="btn" id="btn-round">Runde: 1 / 5</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toolbar-bar">
    <div class="playback-controls">
      <button class="btn" id="btn-play">▶ Abspielen</button>
      <button class="btn" id="btn-restart">↺ Neustart</button>
      <input type="range" id="time-slider" min="0" max="2.6" step="0.02" value="${currentTime}">
      <span class="time-label" id="time-display">${currentTime.toFixed(2)}s / 2.4s</span>
    </div>

    <div class="view-controls">
      <span class="time-label" style="min-width:auto; margin-right:4px;">Ansicht:</span>
      <button class="btn active" data-view="desktop">Desktop (1200×720)</button>
      <button class="btn" data-view="laptop">Laptop (960×580)</button>
      <button class="btn" data-view="portrait">Handy (390×740)</button>
    </div>
  </div>

  <div class="stage-wrap">
    <div class="stage-container" id="stage-box" style="width: 1200px; height: 720px;">
      <canvas id="stage-canvas"></canvas>
    </div>
  </div>

  <div class="metrics-pill" id="metrics-info"></div>
`;

document.body.append(root);

// Elements
const anomalyContainer = root.querySelector('#anomaly-chips')!;
const twistContainer = root.querySelector('#twist-chips')!;
const toggleMayhemBtn = root.querySelector<HTMLButtonElement>('#toggle-mayhem')!;
const playBtn = root.querySelector<HTMLButtonElement>('#btn-play')!;
const restartBtn = root.querySelector<HTMLButtonElement>('#btn-restart')!;
const timeSlider = root.querySelector<HTMLInputElement>('#time-slider')!;
const timeDisplay = root.querySelector('#time-display')!;
const jackpotBtn = root.querySelector<HTMLButtonElement>('#toggle-jackpot')!;
const finaleBtn = root.querySelector<HTMLButtonElement>('#toggle-finale')!;
const roundBtn = root.querySelector<HTMLButtonElement>('#btn-round')!;
const stageBox = root.querySelector<HTMLElement>('#stage-box')!;
const canvas = root.querySelector<HTMLCanvasElement>('#stage-canvas')!;
const metricsInfo = root.querySelector('#metrics-info')!;

// Render anomaly chips
ANOMALIES.forEach((anomaly) => {
  const chip = document.createElement('div');
  chip.className = `chip ${activeAnomalies.has(anomaly) ? 'active' : ''}`;
  const color = ANOMALY_COLORS[anomaly];
  chip.style.setProperty('--chip-color', color);
  chip.innerHTML = `<span class="indicator"></span><span>${t(`anomaly.${anomaly}`)}</span>`;
  chip.addEventListener('click', () => {
    if (activeAnomalies.has(anomaly)) {
      activeAnomalies.delete(anomaly);
    } else {
      activeAnomalies.add(anomaly);
    }
    chip.classList.toggle('active', activeAnomalies.has(anomaly));
    updateMetrics();
  });
  anomalyContainer.append(chip);
});

// Render twist chips
const POPULAR_TWISTS: TwistId[] = ['billiard', 'plasmaStorm', 'minefield', 'precision', 'blind', 'gravityParty', 'ricochetOverdrive', 'void'];
POPULAR_TWISTS.forEach((twistId) => {
  const chip = document.createElement('div');
  const active = activeTwists.includes(twistId);
  chip.className = `chip ${active ? 'active' : ''}`;
  chip.innerHTML = `<span class="indicator"></span><span>${t(`mayhem.twist.${twistId}`)}</span>`;
  chip.addEventListener('click', () => {
    if (!mayhemEnabled) mayhemEnabled = true;
    if (activeTwists.includes(twistId)) {
      activeTwists = activeTwists.filter((id) => id !== twistId);
    } else {
      activeTwists.push(twistId);
    }
    syncChipsUi();
    updateMetrics();
  });
  twistContainer.append(chip);
});

function updateMetrics(): void {
  const aCount = activeAnomalies.size;
  const tCount = mayhemEnabled ? activeTwists.length : 0;
  let layoutName = '';
  if (mayhemEnabled && aCount > 0) {
    layoutName = viewportMode !== 'portrait' ? 'Neuer Look: 2-Spalten-Briefing (Mayhem + Anomalie)' : 'Neuer Look: Kompakter Stack (Portrait)';
  } else if (mayhemEnabled) {
    layoutName = 'Originaler Look: Nur Mayhem (Zentriertes Reel)';
  } else if (aCount > 0) {
    layoutName = 'Originaler Look: Nur Anomalien (Rotes Alarm-Banner wie vorher)';
  } else {
    layoutName = 'Kein Briefing aktiv (normales Spiel)';
  }

  metricsInfo.innerHTML = `
    <span><b>Anomalien:</b> ${aCount}</span>
    <span><b>Mayhem:</b> ${mayhemEnabled ? `Aktiv (${tCount} Twists)` : 'Deaktiviert (aus)'}</span>
    <span><b>Aktiver Screen:</b> ${layoutName}</span>
    <span><b>Zeit:</b> ${currentTime.toFixed(2)}s</span>
    <span><b>Status:</b> ${currentTime >= MAYHEM.LANDED ? '✅ Gelandet (Ready to fire)' : '⏳ Animiert (Reel/Typewriter)'}</span>
  `;
}

// Preset Handler
const PRESETS: Record<string, () => void> = {
  'pinball-billiard': () => {
    mayhemEnabled = true;
    activeAnomalies.clear();
    activeAnomalies.add('pinball');
    activeTwists = ['billiard'];
    jackpot = false;
    finale = false;
    roundNumber = 1;
  },
  'extreme': () => {
    mayhemEnabled = true;
    activeAnomalies.clear();
    ANOMALIES.forEach((a) => activeAnomalies.add(a));
    activeTwists = ['billiard', 'plasmaStorm', 'minefield', 'precision'];
    jackpot = true;
    finale = true;
    roundNumber = 5;
  },
  'balanced': () => {
    mayhemEnabled = true;
    activeAnomalies.clear();
    activeAnomalies.add('trickShots');
    activeAnomalies.add('pinball');
    activeAnomalies.add('unstable');
    activeTwists = ['plasmaStorm', 'billiard'];
    jackpot = false;
    finale = false;
    roundNumber = 2;
  },
  'anomalies-only': () => {
    mayhemEnabled = false; // Mayhem OFF -> Shows original Anomaly Alert!
    activeAnomalies.clear();
    activeAnomalies.add('trickShots');
    activeAnomalies.add('pinball');
    activeAnomalies.add('whiteHole');
    activeAnomalies.add('unstable');
    activeTwists = [];
    jackpot = false;
    finale = false;
    roundNumber = 1;
  },
  'mayhem-only': () => {
    mayhemEnabled = true; // Mayhem ON, Anomalies OFF -> Shows original Mayhem Reveal!
    activeAnomalies.clear();
    activeTwists = ['billiard', 'minefield', 'gravityParty'];
    jackpot = true;
    finale = false;
    roundNumber = 3;
  },
  'quiet': () => {
    mayhemEnabled = true;
    activeAnomalies.clear();
    activeAnomalies.add('pinball');
    activeTwists = []; // Quiet round inside Mayhem
    jackpot = false;
    finale = false;
    roundNumber = 1;
  },
};

root.querySelectorAll<HTMLButtonElement>('.presets-row [data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.preset!;
    PRESETS[key]?.();
    root.querySelectorAll('.presets-row [data-preset]').forEach((b) => b.classList.toggle('active', b === btn));
    syncChipsUi();
    updateMetrics();
  });
});

toggleMayhemBtn.addEventListener('click', () => {
  mayhemEnabled = !mayhemEnabled;
  syncChipsUi();
  updateMetrics();
});

function syncChipsUi(): void {
  anomalyContainer.querySelectorAll<HTMLElement>('.chip').forEach((chip, i) => {
    chip.classList.toggle('active', activeAnomalies.has(ANOMALIES[i]));
  });
  twistContainer.querySelectorAll<HTMLElement>('.chip').forEach((chip, i) => {
    chip.classList.toggle('active', mayhemEnabled && activeTwists.includes(POPULAR_TWISTS[i]));
    chip.style.opacity = mayhemEnabled ? '1' : '0.4';
    chip.style.pointerEvents = mayhemEnabled ? 'auto' : 'none';
  });
  toggleMayhemBtn.textContent = mayhemEnabled ? 'Mayhem: AN' : 'Mayhem: AUS';
  toggleMayhemBtn.classList.toggle('active', mayhemEnabled);
  jackpotBtn.classList.toggle('active', jackpot);
  finaleBtn.classList.toggle('active', finale);
  roundBtn.textContent = `Runde: ${roundNumber} / 5`;
}

jackpotBtn.addEventListener('click', () => {
  jackpot = !jackpot;
  jackpotBtn.classList.toggle('active', jackpot);
  updateMetrics();
});

finaleBtn.addEventListener('click', () => {
  finale = !finale;
  finaleBtn.classList.toggle('active', finale);
  updateMetrics();
});

roundBtn.addEventListener('click', () => {
  roundNumber = (roundNumber % 5) + 1;
  roundBtn.textContent = `Runde: ${roundNumber} / 5`;
  updateMetrics();
});

// Playback controls
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? '⏸ Pausieren' : '▶ Abspielen';
  playBtn.classList.toggle('active', isPlaying);
});

restartBtn.addEventListener('click', () => {
  currentTime = 0;
  timeSlider.value = '0';
  timeDisplay.textContent = `0.00s / 2.4s`;
  isPlaying = true;
  playBtn.textContent = '⏸ Pausieren';
  playBtn.classList.add('active');
  updateMetrics();
});

timeSlider.addEventListener('input', () => {
  currentTime = parseFloat(timeSlider.value);
  timeDisplay.textContent = `${currentTime.toFixed(2)}s / 2.4s`;
  if (isPlaying) {
    isPlaying = false;
    playBtn.textContent = '▶ Abspielen';
    playBtn.classList.remove('active');
  }
  updateMetrics();
});

// Viewport Switcher
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    viewportMode = btn.dataset.view as 'desktop' | 'laptop' | 'portrait';
    root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
    const dims = VIEWPORTS[viewportMode];
    stageBox.style.width = `${dims.w}px`;
    stageBox.style.height = `${dims.h}px`;
    updateMetrics();
  });
});

// Setup Renderer
const effects = new Effects(true, false, 'medium');
const renderer = new Renderer(canvas, () => {
  const dims = VIEWPORTS[viewportMode];
  if (viewportMode === 'portrait') {
    return {
      width: dims.w,
      height: dims.h,
      rotated: true,
      stage: { x: 10, y: 35, w: dims.w - 20, h: dims.h - 70 },
    };
  }
  return { width: dims.w, height: dims.h };
});

const drawOptions: DrawOptions = {
  hud: true,
  fullScreen: false,
  touch: false,
  recording: false,
  keyHints: true,
  aimCardDodge: false,
};

function loop(): void {
  if (isPlaying) {
    currentTime += 1 / 60;
    if (currentTime > 2.6) {
      currentTime = 0;
    }
    timeSlider.value = currentTime.toFixed(2);
    timeDisplay.textContent = `${currentTime.toFixed(2)}s / 2.4s`;
  }
  syncMatch();
  drawOptions.touch = viewportMode === 'portrait';
  renderer.draw(match, effects, drawOptions, 1 / 60);
  requestAnimationFrame(loop);
}

syncChipsUi();
updateMetrics();
void document.fonts.ready.then(() => requestAnimationFrame(loop));
