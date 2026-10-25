import { t } from '../../i18n';
import { heartIcon } from '../dom';
import { h } from '../menu';

type BmcButtonWidget = (text: string, slug: string, color: string, emoji: string, font: string, fontColor: string, outlineColor: string, coffeeColor: string) => string;

let bmcWidget: Promise<BmcButtonWidget | null> | null = null;

let bmcStylesInstalled = false;

function loadBmcWidget(): Promise<BmcButtonWidget | null> {
  if (bmcWidget) return bmcWidget;
  bmcWidget = new Promise((resolve) => {
    const existing = (window as Window & { bmcBtnWidget?: BmcButtonWidget }).bmcBtnWidget;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js';
    script.async = true;
    script.onload = () => resolve((window as Window & { bmcBtnWidget?: BmcButtonWidget }).bmcBtnWidget ?? null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return bmcWidget;
}

/** The version tag; hovering or focusing it swaps the text for who built the game. */
export function creditsBadge(): HTMLElement {
  const link = (user: string) => h('a', { href: `https://github.com/${user}`, target: '_blank', rel: 'noopener noreferrer' }, user);
  return h('div.version.credits', { tabindex: '0' },
    h('span.credits__slot.credits__slot--tag', null,
      h('span.credits__tag', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')),
    ),
    h('span.credits__slot.credits__slot--line', null,
      h('span.credits__line', null,
        `${t('credits.with')} `, heartIcon(), ` ${t('credits.by')} `, link('denzrs'), ' & ', link('matthias-Q'),
        h('span.credits__agents', null, t('credits.agents')),
      ),
    ),
  );
}

/** The official BMC widget uses document.write when initialized from its data-name embed.
 * Load its renderer without that attribute, then mount its generated button into the title UI. */
export function coffeeButton(): HTMLElement {
  const fallback = h('a.coffee-link', {
    href: import.meta.env.VITE_COFFEE_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': t('title.coffee'),
  }, t('title.coffee'));
  const container = h('div.coffee-button', null, fallback);

  void loadBmcWidget().then((renderWidget) => {
    if (!renderWidget || !container.isConnected) return;
    const html = renderWidget('Buy me a coffee', 'slingshot.remake', '#132746', '🚀', 'Bree', '#ffffff', '#5B7DB3', '#FFDD00');
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelector('link[rel="stylesheet"]')?.remove();
    const styles = template.content.querySelector('style');
    const button = template.content.querySelector<HTMLAnchorElement>('.bmc-btn');
    const widget = template.content.querySelector<HTMLElement>('.bmc-btn-container');
    if (!styles || !button || !widget) return;

    button.rel = 'noopener noreferrer';
    if (!bmcStylesInstalled) {
      // The widget's own colours are inline !important, so the quiet footer look has to beat them the same way.
      styles.textContent += `
.coffee-button .bmc-btn, .coffee-button .bmc-btn-text { font-family: var(--font-body) !important; }
.coffee-button .bmc-btn { min-width: 0 !important; height: 32px !important; padding: 0 12px !important; gap: 0; font-size: 0 !important; border: 1px solid rgb(91 125 179 / 0.35) !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; color: var(--bone-dim) !important; letter-spacing: 0.08em; text-transform: uppercase; transition: color 140ms ease, border-color 140ms ease; }
.coffee-button .bmc-btn:hover, .coffee-button .bmc-btn:focus-visible { border-color: var(--sodium) !important; color: var(--sodium) !important; }
.coffee-button .bmc-btn { justify-content: center !important; }
.coffee-button .bmc-btn-text { margin: 0 !important; color: inherit !important; font-size: 10px !important; }
.coffee-button .bmc-btn, .coffee-button .bmc-btn-text { position: relative; }
.coffee-button .bmc-btn::before, .coffee-button .bmc-btn::after, .coffee-button .bmc-btn-text::before, .coffee-button .bmc-btn-text::after { position: absolute; top: 0; line-height: 1; opacity: 0; pointer-events: none; }
.coffee-button .bmc-btn::after { --dx: 52px; --dy: -50px; --rot: 0deg; content: '\\1F680'; font-size: 14px; left: 62%; }
.coffee-button .bmc-btn::before { content: '\\2764\\FE0F'; font-size: 12px; left: 28%; }
.coffee-button .bmc-btn-text::after { --dx: -46px; --dy: -44px; --rot: -90deg; content: '\\1F680'; font-size: 14px; left: 20%; }
.coffee-button .bmc-btn-text::before { content: '\\2764\\FE0F'; font-size: 12px; left: 80%; }
.coffee-button .bmc-btn:is(:hover, :focus-visible)::after { animation: bmc-ship 1.1s ease-in infinite; }
.coffee-button .bmc-btn:is(:hover, :focus-visible)::before { animation: bmc-heart 1.6s ease-out 0.3s infinite; }
.coffee-button .bmc-btn:is(:hover, :focus-visible) .bmc-btn-text::after { animation: bmc-ship 1.3s ease-in 0.6s infinite; }
.coffee-button .bmc-btn:is(:hover, :focus-visible) .bmc-btn-text::before { animation: bmc-heart 1.9s ease-out 0.9s infinite; }
@keyframes bmc-ship { 0% { opacity: 1; transform: translate(0, 0) rotate(var(--rot)) scale(0.8); } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1.1); } }
@keyframes bmc-heart { 0% { opacity: 0; transform: translate(0, 0) scale(0.6); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(-14px, -58px) scale(1.15); } }
@media (prefers-reduced-motion: reduce) { .coffee-button .bmc-btn::before, .coffee-button .bmc-btn::after, .coffee-button .bmc-btn-text::before, .coffee-button .bmc-btn-text::after { animation: none !important; } }
`;
      document.head.append(styles);
      bmcStylesInstalled = true;
    }
    fallback.hidden = true;
    container.append(widget);
  });

  return container;
}
