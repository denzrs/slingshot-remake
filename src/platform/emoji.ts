/** Emoji for the chat: `:smile:` codes and `:-)` smileys, turned into the real thing when a line is sent. */

/** Codes without the colons. Order matters: it is the order suggestions come in. */
const CODES: readonly (readonly [string, string])[] = [
  ['smile', '😄'], ['smiley', '😃'], ['grin', '😁'], ['laughing', '😆'], ['joy', '😂'], ['rofl', '🤣'],
  ['slight_smile', '🙂'], ['wink', '😉'], ['blush', '😊'], ['heart_eyes', '😍'], ['kissing_heart', '😘'],
  ['sunglasses', '😎'], ['thinking', '🤔'], ['neutral', '😐'], ['unamused', '😒'], ['roll_eyes', '🙄'],
  ['sweat_smile', '😅'], ['sob', '😭'], ['cry', '😢'], ['angry', '😠'], ['rage', '🤬'], ['scream', '😱'],
  ['tongue', '😛'], ['stuck_out_tongue_winking_eye', '😜'], ['sleeping', '😴'], ['skull', '💀'], ['ghost', '👻'],
  ['clap', '👏'], ['thumbsup', '👍'], ['thumbsdown', '👎'], ['wave', '👋'], ['pray', '🙏'], ['muscle', '💪'],
  ['ok_hand', '👌'], ['eyes', '👀'], ['heart', '❤️'], ['broken_heart', '💔'], ['fire', '🔥'], ['star', '⭐'],
  ['sparkles', '✨'], ['boom', '💥'], ['100', '💯'], ['tada', '🎉'], ['trophy', '🏆'], ['crown', '👑'],
  ['rocket', '🚀'], ['ufo', '🛸'], ['satellite', '🛰️'], ['comet', '☄️'], ['earth', '🌍'], ['moon', '🌙'],
  ['sun', '☀️'], ['alien', '👽'], ['robot', '🤖'], ['bomb', '💣'], ['zap', '⚡'], ['target', '🎯'],
  ['gg', '🤝'], ['salute', '🫡'], ['party', '🥳'], ['cold', '🥶'], ['hot', '🥵'], ['shrug', '🤷'],
];

/** Smileys and what they become. Longer ones first, so `:-))` is never mistaken for `:-)`. */
const SMILEYS: readonly (readonly [string, string])[] = [
  [':-)', '🙂'], [':)', '🙂'], [':-D', '😄'], [':D', '😄'], [':-(', '🙁'], [':(', '🙁'], [';-)', '😉'], [';)', '😉'],
  [':-P', '😛'], [':P', '😛'], [':-p', '😛'], [':p', '😛'], [':-O', '😮'], [':O', '😮'], [':-o', '😮'], [':o', '😮'],
  [':-|', '😐'], [':|', '😐'], [':-/', '😕'], [":'(", '😢'], ['B-)', '😎'], ['8-)', '😎'], ['<3', '❤️'], [':*', '😘'],
  ['xD', '😆'], ['XD', '😆'],
];

const BY_CODE = new Map(CODES);
const BY_SMILEY = new Map(SMILEYS);

export interface Suggestion {
  /** What is shown and what gets typed: the emoji, and the text that asked for it. */
  emoji: string;
  label: string;
  /** The text this replaces, which ends at the caret. */
  replaces: string;
}

/** How many suggestions the chat offers. */
export const MAX_SUGGESTIONS = 3;

/** Replaces every complete `:code:` and every smileyed word in a line. Unknown codes stay as typed. */
export function emojify(text: string): string {
  return text
    .replace(/:([a-z0-9_+]+):/gi, (whole, code: string) => BY_CODE.get(code.toLowerCase()) ?? whole)
    .split(/(\s+)/)
    .map((word) => BY_SMILEY.get(word) ?? word)
    .join('');
}

/** Up to three suggestions for the word that ends at `caret`. Nothing for a word that is no code and no smiley. */
export function suggest(text: string, caret = text.length): Suggestion[] {
  const word = /(\S+)$/.exec(text.slice(0, caret))?.[1];
  if (!word) return [];
  const found: Suggestion[] = [];
  const add = (emoji: string, label: string) => {
    if (found.length < MAX_SUGGESTIONS) found.push({ emoji, label, replaces: word });
  };

  const code = /^:([a-z0-9_+]{2,})$/i.exec(word)?.[1].toLowerCase();
  if (code) {
    for (const [name, emoji] of CODES) if (name.startsWith(code)) add(emoji, `:${name}:`);
    for (const [name, emoji] of CODES) if (!name.startsWith(code) && name.includes(code)) add(emoji, `:${name}:`);
  }
  if (found.length < MAX_SUGGESTIONS && !/^:[a-z0-9_+]{2,}$/i.test(word)) {
    if (/^[:;<]/.test(word)) for (const [smiley, emoji] of SMILEYS) if (smiley.startsWith(word) && smiley !== word) add(emoji, smiley);
    // A finished smiley is offered too, so the one key press turns it into the emoji.
    const exact = BY_SMILEY.get(word);
    if (exact && found.length < MAX_SUGGESTIONS) found.unshift({ emoji: exact, label: word, replaces: word });
    found.length = Math.min(found.length, MAX_SUGGESTIONS);
  }
  return found;
}

/** The text with the suggestion put in place of the word it was made for. Returns the new caret too. */
export function applySuggestion(text: string, caret: number, s: Suggestion): { text: string; caret: number } {
  const start = caret - s.replaces.length;
  const rest = text.slice(caret);
  const inserted = `${s.emoji}${rest.startsWith(' ') ? '' : ' '}`;
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length };
}
