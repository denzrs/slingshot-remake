import { RULE_KEYS, RULES, type RuleSpec } from '../../src/data/roomRules';

/** How one rule is told to the relay: the part of its entry in the rule table that the relay has to know. */
export interface ContractRule {
  kind: RuleSpec['kind'];
  /** The game modes the rule exists in; left out for every mode. */
  modes?: readonly string[];
  /** A number rule that takes any whole number in this range as well as its options. */
  accepts?: [number, number];
  /** A rule with several values: the values it may hold, and whether it may be empty. */
  options?: readonly string[];
  nonEmpty?: boolean;
}

export interface ContractRules {
  defaults: Record<string, unknown>;
  /** The values of every rule with one value out of a list, as a rules page offers them. */
  options: Record<string, readonly (number | string)[]>;
  rules: Record<string, ContractRule>;
}

/** The rule blocks of `server/protocol-contract.json`, as the rule table (`src/data/roomRules.ts`) says them. */
export function contractRules(): ContractRules {
  const defaults: ContractRules['defaults'] = {};
  const options: ContractRules['options'] = {};
  const rules: ContractRules['rules'] = {};
  for (const key of RULE_KEYS) {
    const spec: RuleSpec = RULES[key];
    defaults[key] = spec.default;
    const entry: ContractRule = { kind: spec.kind };
    if (spec.modes) entry.modes = spec.modes;
    if (spec.kind === 'choice') {
      options[key] = spec.options;
      if (spec.accepts) entry.accepts = [spec.accepts.min, spec.accepts.max];
    } else if (spec.kind === 'set') {
      entry.options = spec.options;
      entry.nonEmpty = spec.nonEmpty;
    }
    rules[key] = entry;
  }
  return { defaults, options, rules };
}

/** The entries of the `rules` block are short enough to stand on one line each. */
const oneLine = (path: readonly string[]): boolean => path.length === 2 && path[0] === 'rules';

/** JSON as the contract is written by hand: objects over several lines, arrays and the entries of `rules` on one. */
export function layout(value: unknown, indent = '', path: readonly string[] = []): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>);
  if (oneLine(path)) return entries.length ? `{ ${entries.map(([key, child]) => `${JSON.stringify(key)}: ${layout(child)}`).join(', ')} }` : '{}';
  const inner = `${indent}  `;
  const lines = entries.map(([key, child]) => `${inner}${JSON.stringify(key)}: ${layout(child, inner, [...path, key])}`);
  return lines.length ? `{\n${lines.join(',\n')}\n${indent}}` : '{}';
}
