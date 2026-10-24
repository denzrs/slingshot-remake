import { MAX_PRESET_NAME } from '../customPresets';
import { t } from '../i18n';
import { h } from './menu';

/** The name of a preset in the creator. Left empty, the placeholder (the next free "My preset n") is the name. */
export function presetNameField(value: string, placeholder: string, changed: (name: string) => void): HTMLElement {
  const input = Object.assign(document.createElement('input'), { type: 'text', maxLength: MAX_PRESET_NAME, value, placeholder, autocomplete: 'off' });
  input.addEventListener('input', () => changed(input.value));
  return h('label.preset-name', null, h('span.preset-name__label', null, t('preset.creator.name')), input);
}
