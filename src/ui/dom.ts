/** Small DOM helper: h('div.class', {…attrs}, …children). */
export function h(tag: string, attrs: Record<string, string> | null, ...children: (Node | string)[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
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
