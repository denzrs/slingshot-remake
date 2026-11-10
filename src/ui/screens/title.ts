import { getLang, t } from '../../platform/i18n';
import type { GameMode } from '../../sim/modes';
import { dailyMenuHint, dailyScreen } from '../daily/daily';
import { factTicker } from '../stats/facts';
import { statsAvailable, statsScreen } from '../stats/stats';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { modeArt } from '../menu/mode-icons';
import { modeName } from '../menu/mode-name';
import type { App } from './app';
import { coffeeButton, creditsBadge } from './credits';
import { languageItem, openSettings } from './settings';
import { prepareModeScreen } from './setup';
import { pickQuickGame, prepareQuickGame } from '../presets/quick-game';
import { tutorialScreen } from './tutorial';
import { hintText } from '../../platform/input-device';

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
  prepareQuickGame();
  // One press plays: a press while the favourites are still on their way is not a second game.
  let quickPending = false;
  let disposed = false;
  const quickGame = (): void => {
    if (quickPending) return;
    quickPending = true;
    void pickQuickGame(app.settings).then(({ mode, settings }) => {
      quickPending = false;
      // Not when the player has gone on to another page meanwhile.
      if (!disposed) app.start(mode, settings);
    });
  };
  // The statistics page has two doors: a line in the menu, and on a phone an icon up by the wordmark.
  const stats = { kind: 'action', hidden: () => !statsAvailable(), label: t('stats.title'), run: () => app.menu.push(() => statsScreen(app)) } as const;
  const items: MenuItem[] = [
    { kind: 'action', section: 'navigation', label: t('launcher.local'), selected: () => launcherSection === 'local', run: () => chooseSection('local') },
    { kind: 'action', section: 'navigation', label: t('launcher.online'), selected: () => launcherSection === 'online', run: () => chooseSection('online') },
    { ...stats, section: 'navigation', className: 'launcher__stats-nav' },
    { kind: 'action', section: 'navigation', className: 'launcher__tutorial-nav', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
    { kind: 'action', section: 'navigation', className: 'launcher__settings-nav', label: t('common.settings'), run: () => openSettings(app) },
    // The phone's icons, in the order they stand beside the wordmark.
    { ...stats, section: 'stats-mobile', className: 'launcher__stats-button' },
    { kind: 'action', section: 'tutorial-mobile', className: 'launcher__tutorial-button', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
    { kind: 'action', section: 'settings-mobile', className: 'launcher__settings-button', label: t('common.settings'), run: () => openSettings(app) },
    modeCard('classic'),
    modeCard('horizon'),
    modeCard('solar'),
    { kind: 'action', section: 'daily', hidden: () => launcherSection !== 'local', label: t('mode.quick'), hint: t('mode.quick.hint'), icon: () => modeArt('quick'), run: quickGame },
    { kind: 'action', section: 'daily', hidden: () => launcherSection !== 'local', label: t('mode.daily'), hint: dailyMenuHint(app.today()), icon: () => modeArt('daily'), run: () => app.menu.push(() => dailyScreen(app)) },
    { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.find'), hint: t('flow.findHint'), icon: () => modeArt('rooms'), run: () => app.openLobby('rooms') },
    { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.create'), hint: t('flow.createHint'), icon: () => modeArt('create'), run: () => app.openLobby('create') },
    { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.code'), hint: t('flow.codeHint'), icon: () => modeArt('code'), run: () => app.openLobby('code') },
    { ...languageItem(app), section: 'language' },
  ];
  return {
    build: () => h('section.screen.screen--title', { 'aria-labelledby': 'wordmark' },
      h('div.launcher', null,
        h('header.launcher__head', null,
          h('div.launcher__brand', null,
            h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
            h('div.launcher__stats-mobile', { 'data-section': 'stats-mobile' }),
            h('div.launcher__tutorial-mobile', { 'data-section': 'tutorial-mobile' }),
            h('div.launcher__settings-mobile', { 'data-section': 'settings-mobile' }),
          ),
          factTicker(app.settings.statsTicker),
        ),
        h('div.launcher__body', null,
          h('nav.launcher__nav.items', { 'data-section': 'navigation', 'aria-label': t('title.menuLabel') }),
          content,
        ),
        h('footer.launcher__foot', null,
          h('p.keys', null, hintText('launcher.keys')),
          h('div.items.launcher__language', { 'data-section': 'language' }),
          h('div.title-foot', null,
            creditsBadge(),
            // The local dev build shows the dev dashboard link where the coffee button sits in production.
            ...(import.meta.env.DEV
              ? [h('a.launcher__debug', {
                href: `/dev/?lang=${getLang()}`,
                'aria-label': 'Dev Dashboard',
              }, 'Debug')]
              : import.meta.env.VITE_COFFEE_URL ? [coffeeButton()] : []),
          ),
        ),
      ),
    ),
    items,
    // The first card of the open section.
    focusItem: items.findIndex((item) => item.section === (launcherSection === 'local' ? 'modes' : 'online')),
    update,
    dispose: () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(resizeFrame);
    },
    onEscape: () => {
      if (launcherSection === 'online') chooseSection('local');
    },
  };
}
