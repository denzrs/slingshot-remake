/** Small DOM helper: h('div.class', {…attrs}, …children). */
export function h(tag: string, attrs: Record<string, string> | null, ...children: (Node | string)[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}
