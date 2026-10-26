/** Small DOM helper: h('div.class', {…attrs}, …children). */
export function h(tag: string, attrs: Record<string, string> | null, ...children: (Node | string)[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** A small heart, drawn rather than typed for the same reason as the eye. */
export function heartIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'heart-icon');
  svg.setAttribute('aria-label', '♥');
  svg.innerHTML = '<path d="M12 21s-8.5-5.4-8.5-11.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8.5 2.8C20.5 15.6 12 21 12 21Z"/>';
  return svg;
}

/** A small eye for "watching" — drawn, not typed, since an emoji is a blank square in fonts that lack it. */
export function eyeIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'eye-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  return svg;
}
