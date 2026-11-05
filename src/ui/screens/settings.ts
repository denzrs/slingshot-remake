import { DEBRIS, type Debris } from '../../sim/config';
import { LANGS, t, type Lang } from '../../platform/i18n';
import { isLook, isPostLevel, LOOKS, lookLabelKey, POST_LEVELS } from '../../data/look';
import { painterFor } from '../../render/looks';
import type { Settings } from '../../data/settings';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { mobileSheet, type SheetSelection } from '../menu/mobile-sheet';
import type { App } from './app';

const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

/** Language picker; the names stay in their own language so it is findable from any UI language. */
export function languageItem(app: App): MenuItem {
  return {
    kind: 'choice',
    label: t('common.language'),
    options: LANGS.map((value) => ({ value, label: LANG_NAMES[value] })),
    get: () => app.settings.language,
    set: (v) => {
      app.settings.language = v as Lang;
      app.settingsChanged();
    },
  };
}

/** The settings that are plain on/off switches. */
type BooleanSetting = { [P in keyof Settings]: Settings[P] extends boolean ? P : never }[keyof Settings];

/** A switch for one on/off setting. */
function settingToggle(app: App, label: string, key: BooleanSetting): MenuItem {
  return {
    kind: 'toggle',
    label,
    get: () => app.settings[key],
    set: (v) => {
      app.settings[key] = v;
      app.settingsChanged();
    },
  };
}

/** Keep the selected subject through language rebuilds within one settings visit. */
export function openSettings(app: App): void {
  const selection: SheetSelection = {};
  app.menu.push(() => settingsScreen(app, selection));
}

/** Only what concerns this device; the rules of a game live on the setup screen. */
function settingsScreen(app: App, selection: SheetSelection): Screen {
  const touch = matchMedia('(pointer: coarse)').matches;
  const sheet = mobileSheet([
    [{ id: 'prefs-display', title: t('shell.display') }],
    [
      { id: 'prefs-device', title: t('shell.soundDevice') },
      { id: 'prefs-language', title: t('common.language') },
      ...(touch ? [{ id: 'prefs-touch', title: t('shell.touch') }] : []),
    ],
  ], t('common.settings'), () => app.menu.refresh(), selection);
  const inGroup = (item: MenuItem, group: 'display' | 'device' | 'language' | 'touch'): MenuItem => ({ ...item, section: `prefs-${group}` } as MenuItem);
  return {
    build: () => menuPage({
      title: t('common.settings'), intro: t('settings.note'), className: 'menu-page--settings',
      navigation: sheet.navigation,
      body: [sheet.el],
      keys: t('briefing.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: ([
      inGroup({
        kind: 'segmented',
        label: t('settings.look'),
        options: LOOKS.map((look) => ({ value: look, label: t(lookLabelKey(look)) })),
        get: () => app.settings.look,
        set: (v: unknown) => {
          app.settings.look = isLook(v) ? v : 'classic';
          app.settingsChanged();
        },
      }, 'display'),
      inGroup({
        kind: 'segmented',
        label: t('settings.postLevel'),
        options: POST_LEVELS.map((value) => ({ value, label: t(`settings.postLevel.${value}`) })),
        // Only a look that lays light over the whole field has anything to turn down.
        hidden: () => !painterFor(app.settings.look).postLevels,
        get: () => app.settings.postLevel,
        set: (v: unknown) => {
          app.settings.postLevel = isPostLevel(v) ? v : 'high';
          app.settingsChanged();
        },
      }, 'display'),
      inGroup(settingToggle(app, t('settings.contours'), 'contours'), 'display'),
      inGroup(settingToggle(app, t('settings.particles'), 'particles'), 'display'),
      inGroup(settingToggle(app, t('settings.aimCardDodge'), 'aimCardDodge'), 'display'),
      inGroup({
        kind: 'segmented',
        label: t('settings.debris'),
        options: (Object.keys(DEBRIS) as Debris[]).map((value) => ({ value, label: t(`settings.debris.${value}`) })),
        hidden: () => !app.settings.particles,
        get: () => app.settings.debris,
        set: (v) => {
          app.settings.debris = v as Debris;
          app.settingsChanged();
        },
      }, 'display'),
      inGroup(settingToggle(app, t('settings.menuBackground'), 'menuBackground'), 'display'),
      inGroup(settingToggle(app, t('settings.statsTicker'), 'statsTicker'), 'display'),
      inGroup(settingToggle(app, t('settings.lessMenuMotion'), 'lessMenuMotion'), 'display'),
      inGroup(settingToggle(app, t('settings.menuSounds'), 'menuSounds'), 'device'),
      inGroup(settingToggle(app, t('settings.gameSounds'), 'gameSounds'), 'device'),
      inGroup({
        kind: 'toggle',
        label: t('settings.fullscreen'),
        get: () => app.isFullscreen(),
        set: () => app.toggleFullscreen(),
      }, 'device'),
      inGroup(languageItem(app), 'language'),
      ...(touch
        ? [inGroup({
            kind: 'segmented',
            label: t('settings.touchControls'),
            options: [
              { value: 'wheel', label: t('settings.touchControls.wheel') },
              { value: 'stick', label: t('settings.touchControls.stick') },
            ],
            get: () => app.settings.touchControls,
            set: (v: unknown) => {
              app.settings.touchControls = v === 'stick' ? 'stick' : 'wheel';
              app.settingsChanged();
            },
          }, 'touch'), inGroup({
            kind: 'segmented',
            label: t('settings.wheelSide'),
            options: [
              { value: 'left', label: t('settings.wheelLeft') },
              { value: 'right', label: t('settings.wheelRight') },
            ],
            get: () => app.settings.wheelSide,
            set: (v: unknown) => {
              app.settings.wheelSide = v === 'left' ? 'left' : 'right';
              app.settingsChanged();
            },
          }, 'touch')]
        : []),
      { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
    ] satisfies MenuItem[]).map(sheet.bind),
    dispose: sheet.dispose,
  };
}
