import './training-guide.css';
import type { Settings } from '../../data/settings';
import type { Training } from '../../game/training';
import { hintText, padMode } from '../../platform/input-device';
import { t } from '../../platform/i18n';
import type { Renderer } from '../../render/renderer';
import { POWER_UP_COLORS } from '../../render/powerup-art';
import { h } from '../dom';

interface Actions {
  settings: Settings;
  /** Where this stands in the first start ("Step 2 of 2"), or nothing when the tutorial is played again from the help. */
  progress?: string;
  /** Leave before the end: the tutorial counts as seen. */
  skip(): void;
  restart(): void;
  assist(): void;
  togglePreview(): void;
  /** The way on at the end: a first real game. */
  firstGame(): void;
  toMenu(): void;
}

/** Only instructions and field annotations. Aiming, HUD, touch controls and firing belong to the running game. */
export function mountTrainingGuide(actions: Actions): { update(training: Training, renderer: Renderer, paused: boolean): void; dispose(): void } {
  const title = h('h2', null);
  const copy = h('p', null);
  const keys = h('p.training-guide__keys', null);
  const route = h('p.training-guide__route', null);
  route.style.color = POWER_UP_COLORS.preview;
  const status = h('p.training-guide__status', { 'aria-live': 'polite' });
  const button = (label: string, run: () => void): HTMLButtonElement => {
    const el = h('button', { type: 'button' }, label) as HTMLButtonElement;
    el.addEventListener('click', run);
    return el;
  };
  // A tool used while aiming hands the keys straight back to the field, so the next Enter fires instead of pressing it again.
  const tool = (label: string, run: () => void): HTMLButtonElement => button(label, () => {
    run();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const assist = tool(t('onboarding.assist'), actions.assist);
  // A switch, off in the planet lesson: the preview is an extra (a power-up in a real game), not how the game is played.
  const preview = tool('', actions.togglePreview);
  preview.classList.add('training-guide__preview');
  preview.style.color = POWER_UP_COLORS.preview;
  preview.title = t('onboarding.preview.note');
  const toMenu = button(t('onboarding.toMenu'), actions.toMenu);
  const firstGame = button(t('onboarding.firstGame'), actions.firstGame);
  firstGame.classList.add('training-guide__primary');
  const restart = tool('↺', actions.restart);
  restart.setAttribute('aria-label', t('onboarding.restart'));
  restart.title = t('onboarding.restart');
  const skip = button(t('onboarding.skipTraining'), actions.skip);
  const root = h('section.training-guide', { 'aria-label': t('onboarding.training') },
    h('div.training-guide__head', null, h('span', null, actions.progress ?? t('onboarding.training')), restart, skip),
    h('div.training-guide__lesson', { 'aria-live': 'polite', 'aria-atomic': 'true' }, title, copy, route, keys),
    status,
    h('div.training-guide__actions', null, preview, assist, toMenu, firstGame));
  const markers = [h('span.training-guide__marker', null, t('onboarding.you')), h('span.training-guide__marker.training-guide__marker--target', null, t('onboarding.target'))];
  document.body.append(root, ...markers);
  const coarse = matchMedia('(pointer: coarse)');
  let seen = '';
  let placed = '';
  /** Where the banner stands, read when it is placed rather than every frame. */
  let banner: DOMRect | null = null;
  let lesson = '';
  return {
    update(training, renderer, paused) {
      root.hidden = paused;
      const touch = coarse.matches;
      const hint = `${training.step}/${touch}/${padMode()}/${actions.settings.touchControls}`;
      const fresh = seen !== hint;
      if (fresh) {
        seen = hint;
        // A new lesson (not a new input device) plays the arrival once, from the start.
        if (lesson !== training.step) {
          lesson = training.step;
          root.classList.remove('training-guide--fresh');
          void root.offsetWidth;
          root.classList.add('training-guide--fresh');
        }
        title.textContent = t(`onboarding.${training.step}.title`);
        copy.textContent = t(`onboarding.${training.step}.text`);
        keys.textContent = training.step === 'done' ? '' : touch
          ? t(actions.settings.touchControls === 'stick' ? 'onboarding.controls.stick' : 'onboarding.controls.touch')
          : hintText('onboarding.keys');
        keys.hidden = !keys.textContent;
        document.body.dataset.trainingStep = training.step;
      }
      const done = training.step === 'done';
      assist.hidden = done || (training.step !== 'gravity' && training.misses === 0);
      assist.disabled = !training.aiming;
      restart.hidden = skip.hidden = preview.hidden = done;
      preview.setAttribute('aria-pressed', String(training.preview));
      const previewLabel = t(training.preview ? 'onboarding.preview.on' : 'onboarding.preview.off');
      if (preview.textContent !== previewLabel) preview.textContent = previewLabel;
      toMenu.hidden = firstGame.hidden = !done;
      // At the end the keyboard goes on from the way out, not from a field nobody aims at any more.
      if (fresh && done && !paused) firstGame.focus({ preventScroll: true });
      status.textContent = training.misses ? t('onboarding.missed') : '';
      status.hidden = !status.textContent || training.step === 'done';
      const suggestion = training.suggestedAim;
      route.hidden = !suggestion || training.step === 'done';
      route.textContent = suggestion ? t('onboarding.solution', suggestion) : '';
      // On a touch screen the coach is a banner along the top, over the score block (the aim card at the ship and the
      // controls show the same numbers), so the middle of the field, where the shots fly, stays free. Where the field
      // leaves it little room above the topmost ship or planet, it gets shorter.
      const placement = `${hint}/${training.misses}/${innerWidth}/${innerHeight}/${paused}/${renderer.view.rotated}/${training.match.world.planets.length}/${training.match.world.ships.map((ship) => ship.alive).join()}`;
      if (placed !== placement && !paused) {
        placed = placement;
        root.classList.toggle('training-guide--banner', touch);
        root.classList.remove('training-guide--compact');
        if (touch) {
          const tops = [
            ...training.match.world.ships.filter((ship) => ship.alive).map((ship) => renderer.project(ship.x, ship.y, null, false).y - 52),
            ...training.match.world.planets.map((planet) => renderer.project(planet.x, planet.y, null, false).y - planet.radius * renderer.view.scale - 10),
          ];
          if (tops.length && root.getBoundingClientRect().bottom > Math.min(...tops)) root.classList.add('training-guide--compact');
        }
        banner = touch ? root.getBoundingClientRect() : null;
      }
      // A label the banner would cut in half is left out: the ships themselves stay in sight below it.
      markers.forEach((marker, i) => {
        const ship = training.match.world.ships[i];
        const point = renderer.project(ship.x, ship.y, null, false);
        marker.style.left = `${point.x}px`;
        marker.style.top = `${point.y}px`;
        marker.style.color = training.match.players[i].color;
        const label = point.y - 50;
        const covered = !!banner && !paused && label < banner.bottom && point.x > banner.left - 40 && point.x < banner.right + 40;
        marker.hidden = paused || !ship.alive || covered;
      });
    },
    dispose() {
      root.remove();
      markers.forEach((marker) => marker.remove());
      delete document.body.dataset.trainingStep;
    },
  };
}
