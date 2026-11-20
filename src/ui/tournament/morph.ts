/**
 * Brings a drawn element to the state of a freshly built one without replacing it. The arena is rebuilt on every change from the
 * relay, and a rebuilt element starts its animations and transitions over: the pulsing live dot restarts, the tug of war jumps
 * instead of sliding. Updating the old element in place keeps them running.
 *
 * Elements carrying `data-key` are matched by it, all others by their place among their siblings. An element is only reused for
 * one of the same tag and key; its event listeners stay, so give an element another key when its handler would differ.
 */
export function morph(old: Element, fresh: Element): void {
  syncAttributes(old, fresh);
  morphChildren(old, fresh);
}

const keyOf = (node: Node): string | null => (node instanceof Element ? node.getAttribute('data-key') : null);

const same = (a: Node, b: Node): boolean =>
  a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);

function syncAttributes(old: Element, fresh: Element): void {
  for (const { name } of [...old.attributes]) if (!fresh.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of [...fresh.attributes]) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
}

function morphChildren(old: Element, fresh: Element): void {
  const unused: ChildNode[] = [...old.childNodes];
  const keyed = new Map<string, ChildNode[]>();
  for (const node of unused) {
    const key = keyOf(node);
    if (key !== null) keyed.set(key, [...(keyed.get(key) ?? []), node]);
  }
  const take = (node: ChildNode): void => {
    const at = unused.indexOf(node);
    if (at >= 0) unused.splice(at, 1);
  };

  const result: Node[] = [];
  for (const next of [...fresh.childNodes]) {
    const key = keyOf(next);
    let match: ChildNode | undefined;
    if (key !== null) {
      match = keyed.get(key)?.shift();
    } else {
      // Unkeyed: the next unclaimed unkeyed sibling of the same kind, in order.
      match = unused.find((node) => keyOf(node) === null && same(node, next));
    }
    if (match && same(match, next)) {
      take(match);
      if (match instanceof Element && next instanceof Element) morph(match, next);
      else if (match.nodeValue !== next.nodeValue) match.nodeValue = next.nodeValue;
      result.push(match);
    } else {
      result.push(next);
    }
  }
  for (const node of unused) node.remove();

  // Put them in order, touching only what is out of place: moving an element would restart its animations.
  let cursor: Node | null = old.firstChild;
  for (const node of result) {
    if (node === cursor) cursor = cursor.nextSibling;
    else old.insertBefore(node, cursor);
  }
}
