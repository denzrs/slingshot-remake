/**
 * Rule ideas that are being tried before they are rules. An experiment exists only in the dev build, offline, in a
 * match the person at the keyboard started: it is not in `RoomRules`, so it has no wire, no relay, no rules page, no
 * preset and no translation. Switch one on with `?try=name` (several: `?try=a,b`) or in the dev panel (`?debug`).
 *
 * A match asks `this.trying('name')` where the idea lives. When the idea is kept it becomes a rule, and its `trying`
 * checks become reads of that rule; when it is dropped, delete its entry here and the compiler names every check to
 * remove. See `docs/plans/cheaper-rules.md`.
 *
 * What an experiment may not do: touch `src/net`, `server/`, the rules or their page, the presets or `i18n`; add to a
 * snapshot; or draw from a random stream while it is off (the replay tests would notice).
 */
export const EXPERIMENTS = {
  /** Changes nothing. It is here so the lane has something to switch on and test; delete it with the first real one. */
  'lane-check': 'Does nothing: shows that the experiment lane is wired up',
} as const satisfies Record<string, string>;

export type Experiment = keyof typeof EXPERIMENTS;

export const EXPERIMENT_NAMES = Object.keys(EXPERIMENTS) as Experiment[];

export const isExperiment = (value: unknown): value is Experiment => typeof value === 'string' && Object.hasOwn(EXPERIMENTS, value);

/** The URL parameter that switches experiments on. */
export const EXPERIMENT_PARAM = 'try';

/** The experiments a page address asks for: known names only, each once, in the usual order. */
export function experimentsFrom(search: string): Experiment[] {
  const asked = new URLSearchParams(search).get(EXPERIMENT_PARAM)?.split(',').map((name) => name.trim()) ?? [];
  return EXPERIMENT_NAMES.filter((name) => asked.includes(name));
}
