import { getLang, t } from '../../platform/i18n';
import { installHint, isIos, isStandalone, loadInstallDismissed, saveInstallDismissed, updateNoticeVisible, type Pwa } from '../../platform/pwa';
import { h } from '../dom';
import icon from './pwa-icon.png';

/** A symbol drawn in the colour of the strip: the share button of iOS (a box with an arrow leaving it), a turning arrow for an update, or an arrow into a tray for the install. */
function glyph(kind: 'ios' | 'update' | 'install'): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'pwa-banner__glyph');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = kind === 'ios'
    ? '<path d="M12 15V3.5M7.8 7.4 12 3.2l4.2 4.2M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5"/>'
    : kind === 'install'
      ? '<path d="M12 3.5v11M7.8 10.6l4.2 4.2 4.2-4.2M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'
      : '<path d="M20.5 15a9 9 0 1 1-2.1-9.4L22.5 9.5M22.5 3.5v6h-6"/>';
  return svg;
}

export type PwaHint = 'update' | 'outdated' | 'android' | 'ios';

/**
 * The app's logo. With a symbol it takes turns with it in the same place (the logo blurs away, the symbol comes forward, and back):
 * on iOS the share button to tap, for an update the arrow that turns, for the install the arrow into a tray.
 */
function logoMark(symbol: 'ios' | 'update' | 'install'): HTMLElement {
  const logo = h('span.pwa-banner__logo.pwa-banner__logo--turns', null, h('img.pwa-banner__icon', { src: icon, alt: '', width: '48', height: '48', 'aria-hidden': 'true' }));
  logo.append(h('span.pwa-banner__glyph-tile', null, glyph(symbol)));
  return logo;
}

/**
 * The offer to install, as a note on a page (the tutorial's first). It is shown whenever installing is possible, whatever the player
 * did with the strip on the menu: null when the app is already installed or this browser has no way to do it.
 */
export function installNote(pwa: Pwa): HTMLElement | null {
  const ios = isIos();
  const kind = installHint({ standalone: isStandalone(), ios, hasPrompt: pwa.canInstall, dismissedAt: null, now: Date.now() });
  if (kind === 'none') return null;
  const note = h('aside.install-note', { role: 'note' }, logoMark(kind === 'ios' ? 'ios' : 'install'), h('p', null, t(kind === 'ios' ? 'pwa.iosHint' : 'pwa.tip')));
  if (kind === 'android') {
    const action = h('button.install-note__action', { type: 'button' }, t('pwa.installButton'));
    action.addEventListener('click', () => void pwa.install());
    note.append(action);
  }
  return note;
}

/**
 * The one strip at the foot of the menus that says a new version is ready, or offers the game for the home screen. An update
 * comes first and is never shown in a match (reloading would end it); the install hint can be closed and then stays away for a month.
 */
export class PwaBanner {
  private readonly ios = isIos();
  private readonly standalone = isStandalone();
  private dismissedAt = loadInstallDismissed();
  private outdated = false;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly pwa: Pwa,
    /** Dev pages only: show this hint whatever the browser says, and remember nothing of it. */
    private readonly forced: PwaHint | null = null,
  ) {
    pwa.onChange(() => this.shown = '');
  }

  /** The relay has turned this build away as out of date: say so, wherever the player is outside a match. */
  setOutdated(outdated: boolean): void {
    if (this.outdated === outdated) return;
    this.outdated = outdated;
    this.shown = '';
  }

  /**
   * Cheap to call every frame: it only builds the strip when what it shows changes. A new version waiting and the offer to install
   * show on the main menu only: not in a match (a reload would end it) and not on a page of the menu, where the strip would cover that
   * page's own controls. An out-of-date build is told wherever it is outside a match, since that is where it tried to connect.
   */
  update(inMatch: boolean, onTitle: boolean): void {
    const natural: PwaHint | 'none' = this.outdated && !inMatch
      ? 'outdated'
      : updateNoticeVisible({ waiting: this.pwa.updateWaiting, inMatch: inMatch || !onTitle })
        ? 'update'
        : inMatch || !onTitle
          ? 'none'
          : installHint({ standalone: this.standalone, ios: this.ios, hasPrompt: this.pwa.canInstall, dismissedAt: this.dismissedAt, now: Date.now() });
    const kind = this.forced ?? natural;
    const key = `${kind}:${getLang()}`;
    if (key === this.shown) return;
    this.shown = key;
    this.root.replaceChildren();
    this.root.hidden = kind === 'none';
    // An out-of-date build looks like a waiting update: same glow, same symbol, same size.
    this.root.dataset.kind = kind === 'outdated' ? 'update' : kind;
    if (kind === 'none') return;

    this.root.append(logoMark(kind === 'android' ? 'install' : kind === 'outdated' ? 'update' : kind));
    const text = t(kind === 'update' ? 'pwa.update' : kind === 'outdated' ? 'pwa.outdated' : kind === 'ios' ? 'pwa.iosHint' : 'pwa.install');
    this.root.append(h('p', null, text));
    if (kind !== 'ios') {
      const action = h('button.pwa-banner__action', { type: 'button' }, t(kind === 'update' || kind === 'outdated' ? 'pwa.reload' : 'pwa.installButton'));
      action.addEventListener('click', () => {
        if (kind === 'update') this.pwa.applyUpdate();
        else if (kind === 'outdated') void this.pwa.refresh();
        else void this.pwa.install();
      });
      this.root.append(action);
    }
    if (kind === 'android' || kind === 'ios') {
      const close = h('button.pwa-banner__close', { type: 'button', 'aria-label': t('pwa.dismiss') }, '×');
      close.addEventListener('click', () => {
        if (this.forced) {
          this.root.hidden = true;
          return;
        }
        this.dismissedAt = Date.now();
        saveInstallDismissed(this.dismissedAt);
        this.shown = '';
        this.update(false, true);
      });
      this.root.append(close);
    }
  }
}
