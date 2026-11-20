import { onlineAllowed, setOnline } from '../../data/online';
import { t, type Key } from '../../platform/i18n';
import { hintText } from '../../platform/input-device';
import { leaderboardAvailable } from '../daily/leaderboard';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import type { App } from './app';
import { privacyHref } from './privacy';

/**
 * What the online features unlock, as the introduction and the prompt list it. A build without a relay of its own (a
 * self-hosted copy) has no leaderboard, statistics or reports, so only the games are named.
 */
export function onlineFeatureKeys(): Key[] {
  const always: Key[] = ['online.feature.play', 'online.feature.tournament'];
  if (!leaderboardAvailable()) return always;
  return [...always, 'online.feature.daily', 'online.feature.stats', 'online.feature.quick', 'online.feature.report'];
}

export function onlineFeatureList(className = 'online-features'): HTMLElement {
  return h(`ul.${className}`, null, ...onlineFeatureKeys().map((key) => h('li', null, t(key))));
}

/** The privacy page in a tab of its own, so the page that links to it stays where it was. */
export function openPrivacyPage(): void {
  window.open(privacyHref(), '_blank', 'noopener');
}

/** Asks to turn online on; `then` runs once it is, on the page the prompt was opened from. */
export function onlinePromptScreen(app: App, then?: () => void): Screen {
  const enable = (): void => {
    setOnline(true);
    app.menu.back();
    then?.();
  };
  return {
    build: () => menuPage({
      title: t('online.prompt.title'),
      className: 'menu-page--online-prompt',
      body: [
        h('article.online-prompt', null,
          h('p', null, t('online.prompt.text')),
          onlineFeatureList(),
          h('p.online-prompt__note', null, t('online.prompt.note')),
        ),
      ],
      keys: hintText('shell.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: [
      { kind: 'action', section: 'actions', label: t('online.privacy'), run: openPrivacyPage },
      { kind: 'action', section: 'actions', label: t('online.prompt.keepOff'), run: () => app.menu.back() },
      { kind: 'action', section: 'actions', label: t('online.enable'), primary: true, run: enable },
    ] satisfies MenuItem[],
    focus: 2,
  };
}

/** Runs `run` when online is on; otherwise asks first, and runs it after a yes. */
export function requireOnline(app: App, run: () => void): void {
  if (onlineAllowed()) run();
  else app.menu.push(() => onlinePromptScreen(app, run));
}

/**
 * A menu row that needs the relay. Offline it stays in view, greyed, so the player sees what they are missing; a card also
 * carries "Online ist aus" in its corner (a plain row has no room for it). Choosing it asks to turn online on and then does
 * what the row does.
 */
export function onlineItem<T extends Extract<MenuItem, { kind: 'action' }>>(app: App, item: T): T {
  if (onlineAllowed()) return item;
  return {
    ...item,
    className: [item.className, 'item--offline'].filter(Boolean).join(' '),
    ...(item.icon ? { tag: t('online.off') } : {}),
    run: () => requireOnline(app, item.run),
  };
}
