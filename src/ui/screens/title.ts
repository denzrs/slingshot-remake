import { t } from '../../i18n';
import type { GameMode } from '../../modes';
import { dailyMenuHint, dailyScreen } from '../daily';
import { factTicker } from '../facts';
import { h, type MenuItem, type Screen } from '../menu';
import { modeArt } from '../mode-icons';
import { modeName } from '../mode-name';
import type { App } from './app';
import { coffeeButton, creditsBadge } from './credits';
import { languageItem, settingsScreen } from './settings';
import { prepareModeScreen } from './setup';
import { tutorialScreen } from './tutorial';

type LauncherSection = 'local' | 'online';

let launcherSection: LauncherSection = 'local';

/** The modes live on the title screen: choose here, prepare the match next. */
export function titleScreen(app: App): Screen {
  const sectionTitle = h('h2', null);
  const modesWrap = h('div.items.items--row.launcher__modes', { 'data-section': 'modes', role: 'group', 'aria-label': t('launcher.choose') });
  const dailyWrap = h('div.items.launcher__daily', { 'data-section': 'daily' });
  const onlineWrap = h('div.items.items--row.launcher__online', { 'data-section': 'online', role: 'group', 'aria-label': t('launcher.online') });
  const content = h('div.launcher__content', null,
    h('div.launcher__section-head', null, sectionTitle),
    modesWrap,
    dailyWrap,
    onlineWrap,
  );
  const showSection = (section: LauncherSection): void => {
    sectionTitle.textContent = t(section === 'local' ? 'launcher.choose' : 'launcher.online');
    modesWrap.hidden = section !== 'local';
    dailyWrap.hidden = section !== 'local';
    onlineWrap.hidden = section !== 'online';
    for (const [wrap, visible] of [
      [modesWrap, section === 'local'],
      [dailyWrap, section === 'local'],
      [onlineWrap, section === 'online'],
    ] as const) {
      for (const item of wrap.children) (item as HTMLElement).hidden = !visible;
    }
  };
  const update = (): void => {
    // Measure both sections at the current width and reserve the taller one. This keeps the
    // footer anchored even on short viewports where the content itself cannot fill the shell.
    // Retain fractional pixels so repeated measurements cannot grow the shell.
    content.style.minHeight = '';
    showSection('local');
    const localHeight = parseFloat(getComputedStyle(content).height);
    showSection('online');
    const onlineHeight = parseFloat(getComputedStyle(content).height);
    showSection(launcherSection);
    content.style.minHeight = `${Math.max(localHeight, onlineHeight)}px`;
  };
  const chooseSection = (section: LauncherSection): void => {
    if (section !== launcherSection) {
      const direction = section === 'online' ? 'next' : 'previous';
      content.classList.remove('launcher__content--enter-next', 'launcher__content--enter-previous');
      void content.offsetWidth;
      content.classList.add(`launcher__content--enter-${direction}`);
    }
    launcherSection = section;
    app.menu.refresh();
    app.menu.focusSection(section === 'local' ? 'modes' : 'online');
  };
  const modeCard = (mode: GameMode): MenuItem => ({
    kind: 'action', section: 'modes', label: modeName(mode), hint: t(`mode.${mode}.hint`),
    icon: () => modeArt(mode),
    hidden: () => launcherSection !== 'local',
    run: () => app.menu.push(prepareModeScreen(app, mode)),
  });
  // A resize fires many times per frame while a window is dragged; measuring both sections once per frame is enough.
  let resizeFrame = 0;
  const onResize = (): void => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      update();
    });
  };
  window.addEventListener('resize', onResize);
  return {
    build: () => h('section.screen.screen--title', { 'aria-labelledby': 'wordmark' },
      h('div.launcher', null,
        h('header.launcher__head', null,
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
          factTicker(app.settings.statsTicker),
        ),
        h('div.launcher__body', null,
          h('nav.launcher__nav.items', { 'data-section': 'navigation', 'aria-label': t('title.menuLabel') }),
          content,
        ),
        h('footer.launcher__foot', null,
          h('p.keys', null, t('launcher.keys')),
          h('div.items.launcher__language', { 'data-section': 'language' }),
          h('div.title-foot', null,
            creditsBadge(),
            ...(import.meta.env.VITE_COFFEE_URL ? [coffeeButton()] : []),
          ),
        ),
      ),
    ),
    items: [
      { kind: 'action', section: 'navigation', label: t('launcher.local'), selected: () => launcherSection === 'local', run: () => chooseSection('local') },
      { kind: 'action', section: 'navigation', label: t('launcher.online'), selected: () => launcherSection === 'online', run: () => chooseSection('online') },
      { kind: 'action', section: 'navigation', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
      { kind: 'action', section: 'navigation', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      modeCard('classic'),
      modeCard('horizon'),
      modeCard('solar'),
      { kind: 'action', section: 'daily', hidden: () => launcherSection !== 'local', label: t('mode.daily'), hint: dailyMenuHint(app.today()), icon: () => modeArt('daily'), run: () => app.menu.push(() => dailyScreen(app)) },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.find'), hint: t('flow.findHint'), icon: () => modeArt('rooms'), run: () => app.openLobby('rooms') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.create'), hint: t('flow.createHint'), icon: () => modeArt('create'), run: () => app.openLobby('create') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.code'), hint: t('flow.codeHint'), icon: () => modeArt('code'), run: () => app.openLobby('code') },
      { ...languageItem(app), section: 'language' },
    ],
    focus: launcherSection === 'local' ? 4 : 7,
    update,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(resizeFrame);
    },
    onEscape: () => {
      if (launcherSection === 'online') chooseSection('local');
    },
  };
}
