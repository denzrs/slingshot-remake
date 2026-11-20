import { t, type Key } from '../../platform/i18n';
import type { FactPart } from '../../net/statsFacts';

/** A tip is a sentence of the language file, with the name of the thing it points at (an anomaly, a mode) set apart. */
interface Tip {
  key: Key;
  name?: Key;
}

const TIPS: readonly Tip[] = [
  { key: 'tip.trickShots', name: 'anomaly.trickShots' },
  { key: 'tip.pinball', name: 'anomaly.pinball' },
  { key: 'tip.fuse', name: 'anomaly.fuse' },
  { key: 'tip.whiteHole', name: 'anomaly.whiteHole' },
  { key: 'tip.unstable', name: 'anomaly.unstable' },
  { key: 'tip.darkMatter', name: 'anomaly.darkMatter' },
  { key: 'tip.fusion', name: 'anomaly.fusion' },
  { key: 'tip.mayhem', name: 'preset.mayhem' },
  { key: 'tip.daily' },
  { key: 'tip.online' },
  { key: 'tip.tournament' },
  { key: 'tip.solar' },
  { key: 'tip.horizon' },
  { key: 'tip.preview' },
];

/** Marks the name inside the sentence while the language file fills it in; no sentence has this character itself. */
const MARK = '\u0001';

function tipParts(tip: Tip): FactPart[] {
  const sentence = tip.name ? t(tip.key, { name: `${MARK}${t(tip.name)}${MARK}` }) : t(tip.key);
  // Odd pieces are the name, the ones between are the words around it.
  return sentence
    .split(MARK)
    .map((text, i): FactPart => ({ text, number: i % 2 === 1, ...(i % 2 === 1 ? { name: true } : {}) }))
    .filter((part) => part.text !== '');
}

/** Up to `count` tips of the game (anomalies, modes, how to play), in the player's language and a different order on every call. */
export function tipLines(count: number): FactPart[][] {
  const order = [...TIPS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count).map(tipParts);
}
