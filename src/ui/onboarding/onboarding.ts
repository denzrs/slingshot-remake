import './onboarding.css';
import { LOOKS, lookLabelKey, RECOMMENDED_LOOK, type Look } from '../../data/look';
import { saveSettings, type Settings } from '../../data/settings';
import { applyStaticTexts, getLang, LANGS, LANG_NAMES, setLang, t, type Lang } from '../../platform/i18n';
import { hintText } from '../../platform/input-device';
import type { Sound } from '../../platform/audio';
import { h } from '../dom';
import { buildControl } from '../menu/controls';
import { lookPreview, PREVIEW_SCENES, type PreviewScene } from './look-preview';
import { preloadAssets } from '../../render/looks/forged-assets';

const PROFILES = [
  { facts: ['onboarding.look.simple.1', 'onboarding.look.simple.2', 'onboarding.look.simple.3'] },
  { facts: ['onboarding.look.rendered.1', 'onboarding.look.rendered.2', 'onboarding.look.rendered.3'] },
  { facts: ['onboarding.look.projection.1', 'onboarding.look.projection.2', 'onboarding.look.projection.3'] },
] as const;

interface Options {
  settings: Settings;
  sound?: Sound;
  /** The look selected at first: the recommended one on a new device, the saved one where the player chose before. */
  initialLook?: Look;
  startTraining(look: Look): void;
  /** Skipping keeps the look on screen: the player saw it selected. */
  skip(look: Look): void;
}

/** One live field, one graphics choice: the accepted split-preview layout. */
export function openOnboarding(options: Options): { dispose(): void } {
  void preloadAssets(['hole', 'sunFront', 'ship', 'shipMask', 'gas', 'ice', 'rock']);
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'onboarding';
  dialog.setAttribute('aria-labelledby', 'onboarding-title');
  let selected = options.initialLook ?? RECOMMENDED_LOOK;
  let scene: PreviewScene = 'gravity';
  let closed = false;
  let frame = 0;
  let autoCyclePaused = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || options.settings.lessMenuMotion;
  const action = (label: string, run: () => void, className: string): HTMLButtonElement => {
    const button = h(`button.${className}`, { type: 'button' }, label) as HTMLButtonElement;
    button.addEventListener('click', run);
    return button;
  };
  const canvas = h('canvas', { role: 'img', 'aria-label': t('onboarding.scene.gravity') }) as HTMLCanvasElement;
  const choices = h('div.onboarding__choices', { role: 'group', 'aria-label': t('onboarding.choose') });
  const scenes = h('nav.onboarding__scene-tabs', { 'aria-label': t('onboarding.scenes') });
  const title = h('h3', null);
  const recommendation = h('span.onboarding__recommended', null, t('onboarding.recommended'));
  const facts = h('ul.onboarding__facts', null);
  const eyebrow = h('p.eyebrow', null, t('onboarding.welcome'));
  const overline = h('p.onboarding__overline', null, t('onboarding.details'));
  const settingsNote = h('p.onboarding__settings-note', null, t('onboarding.chooseHint'));
  const stepHeader = h('h2.onboarding__step', { id: 'onboarding-title' }, h('span', null, t('onboarding.step')), ' ', t('onboarding.choose'));
  const footerText = h('p.keys', null, hintText('flow.tabKeys'));

  const changeLanguage = (lang: Lang): void => {
    if (getLang() === lang) return;
    options.settings.language = lang;
    saveSettings(options.settings);
    setLang(lang);
    applyStaticTexts();
    refreshTexts();
  };

  const langControl = buildControl(
    {
      kind: 'choice',
      get label() { return t('common.language'); },
      options: LANGS.map((value) => ({ value, label: LANG_NAMES[value] })),
      get: () => getLang(),
      set: (v) => changeLanguage(v as Lang),
    },
    {
      sound: options.sound,
      changed: () => {},
    },
  );
  const langContainer = h('div.items.launcher__language.onboarding__language', { 'data-section': 'language' }, langControl.el);

  const details = h('aside.onboarding__details', { 'aria-live': 'polite' },
    overline,
    h('div.onboarding__profile-title', null, title, recommendation), facts,
    settingsNote);
  const thumbnails: { look: Look; canvas: HTMLCanvasElement; preview?: ReturnType<typeof lookPreview> }[] = [];
  let preview: ReturnType<typeof lookPreview>;

  const updateThumbnails = (): void => {
    for (const thumbnail of thumbnails) {
      if (!thumbnail.preview) {
        thumbnail.preview = lookPreview(thumbnail.canvas, options.settings);
      }
      thumbnail.preview.setScene(scene);
      thumbnail.preview.draw(0, thumbnail.look, true);
    }
  };

  const select = (look: Look, force = false): void => {
    if (selected === look && !force && choices.querySelector('[aria-pressed="true"]')) return;
    selected = look;
    const profile = PROFILES[LOOKS.indexOf(look)];
    title.textContent = t(lookLabelKey(look));
    recommendation.textContent = t('onboarding.recommended');
    recommendation.hidden = look !== RECOMMENDED_LOOK;
    facts.replaceChildren(...profile.facts.map((key) => h('li', null, t(key))));
    [...choices.children].forEach((button, i) => {
      const isSelected = LOOKS[i] === look;
      button.setAttribute('aria-pressed', String(isSelected));
      if (isSelected && !force) {
        button.classList.remove('onboarding__choice--flash');
        requestAnimationFrame(() => button.classList.add('onboarding__choice--flash'));
      } else if (!isSelected) {
        button.classList.remove('onboarding__choice--flash');
      }
    });
  };

  const selectScene = (next: PreviewScene): void => {
    scene = next;
    preview.setScene(next);
    updateThumbnails();
    canvas.setAttribute('aria-label', t(`onboarding.scene.${next}`));
    [...scenes.children].forEach((button, i) => button.setAttribute('aria-pressed', String(PREVIEW_SCENES[i] === next)));
  };

  const refreshTexts = (): void => {
    eyebrow.textContent = t('onboarding.welcome');
    skipButton.textContent = t('onboarding.skip');
    stepHeader.replaceChildren(h('span', null, t('onboarding.step')), ' ', t('onboarding.choose'));
    overline.textContent = t('onboarding.details');
    settingsNote.textContent = t('onboarding.chooseHint');
    nextButton.textContent = `${t('onboarding.continue')} →`;
    footerText.textContent = hintText('flow.tabKeys');
    scenes.setAttribute('aria-label', t('onboarding.scenes'));
    choices.setAttribute('aria-label', t('onboarding.choose'));
    canvas.setAttribute('aria-label', t(`onboarding.scene.${scene}`));

    [...scenes.children].forEach((btn, i) => {
      btn.textContent = t(`onboarding.scene.${PREVIEW_SCENES[i]}`);
    });

    [...choices.children].forEach((btn, i) => {
      const look = LOOKS[i];
      const nameEl = btn.querySelector('.onboarding__choice-name');
      if (nameEl) nameEl.textContent = t(lookLabelKey(look));
      const recEl = btn.querySelector('.onboarding__choice-recommendation');
      if (recEl) recEl.textContent = t('onboarding.recommended');
    });

    const labelEl = langControl.el.querySelector('.item__label');
    if (labelEl) labelEl.textContent = t('common.language');
    langControl.refresh();

    select(selected, true);
  };

  for (const look of LOOKS) {
    const thumbnail = h('canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const button = action('', () => select(look), 'onboarding__choice');
    button.dataset.look = look;
    button.append(
      h('span.onboarding__choice-image', null, thumbnail),
      h('span.onboarding__choice-label', null,
        h('span.onboarding__choice-name', null, t(lookLabelKey(look))),
        ...(look === RECOMMENDED_LOOK ? [h('span.onboarding__choice-recommendation', null, t('onboarding.recommended'))] : []),
      ),
    );
    choices.append(button);
    thumbnails.push({ look, canvas: thumbnail });
  }

  for (const next of PREVIEW_SCENES) {
    scenes.append(action(t(`onboarding.scene.${next}`), () => selectScene(next), 'onboarding__scene-button'));
  }

  const dispose = (): void => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    preview.dispose();
    thumbnails.forEach((thumbnail) => thumbnail.preview?.dispose());
    dialog.close();
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const skip = (): void => { dispose(); options.skip(selected); };
  const skipButton = action(t('onboarding.skip'), skip, 'onboarding__skip');
  const stage = h('div.onboarding__preview', null, h('div.onboarding__field', null, canvas), scenes);
  stage.addEventListener('pointerenter', () => { autoCyclePaused = true; });
  stage.addEventListener('pointerleave', () => { autoCyclePaused = false; });
  const nextButton = action(`${t('onboarding.continue')} →`, () => { dispose(); options.startTraining(selected); }, 'onboarding__continue');
  dialog.append(h('div.onboarding__frame', null,
    h('header.onboarding__header', null,
      eyebrow,
      h('h1.wordmark', null, 'Slingshot'),
      skipButton),
    stepHeader,
    h('main.onboarding__workspace', null, stage, details, choices, nextButton),
    h('footer.onboarding__footer', null, footerText, langContainer)));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); skip(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement)?.closest('input, textarea, [contenteditable=true], .launcher__language, .onboarding__language')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    if ((event.target as HTMLElement)?.closest('.onboarding__scene-tabs')) {
      selectScene(PREVIEW_SCENES[(PREVIEW_SCENES.indexOf(scene) + direction + PREVIEW_SCENES.length) % PREVIEW_SCENES.length]);
    } else select(LOOKS[(LOOKS.indexOf(selected) + direction + LOOKS.length) % LOOKS.length]);
  });
  let pointer: { id: number; x: number } | null = null;
  stage.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    pointer = { id: event.pointerId, x: event.clientX };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointerup', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    pointer = null;
    if (Math.abs(dx) > 50) select(LOOKS[(LOOKS.indexOf(selected) + (dx < 0 ? 1 : LOOKS.length - 1)) % LOOKS.length]);
  });
  stage.addEventListener('pointercancel', () => { pointer = null; });
  document.body.append(dialog);
  dialog.showModal();
  preview = lookPreview(canvas, options.settings, {
    onSceneEnd: (completedScene) => {
      if (autoCyclePaused) return;
      const nextIndex = (PREVIEW_SCENES.indexOf(completedScene) + 1) % PREVIEW_SCENES.length;
      selectScene(PREVIEW_SCENES[nextIndex]);
    },
  });
  select(selected);
  selectScene(scene);
  choices.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  let last = 0;
  const tick = (now: number): void => {
    if (closed) return;
    if (now - last < 30) { frame = requestAnimationFrame(tick); return; }
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!document.hidden) {
      preview.draw(dt, selected, reduced);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { dispose };
}
