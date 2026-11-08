import { t, type Key } from './i18n';

/** What a person last played or navigated with: the hints on screen name its keys. */
export type InputDevice = 'keyboard' | 'pointer' | 'pad';

let last: InputDevice = 'keyboard';

export const lastInput = (): InputDevice => last;

export function noteInput(device: InputDevice): void {
  last = device;
}

/** The lines of key hints at the foot of the menus; each has a twin written for the pad. */
type KeysLine = 'shell.keys' | 'launcher.keys' | 'flow.tabKeys' | 'briefing.keys' | 'title.keys' | 'setup.keys' | 'over.keys';

/** A line of key hints in the words of the device that was used last. */
export function keysLine(key: KeysLine): string {
  return t(last === 'pad' ? (`${key}.pad` as const) satisfies Key : key);
}
