import { getLang } from '../i18n';

/** "Fri, 2 October 2026" in the UI language. */
export function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}
