/** HTML entry points shared by the Vite gate, the overview and every dev header. */
export const DEV_PAGES = [
  { id: 'home', path: '/dev/', legacy: '/dev.html', title: 'dev.home', description: 'dev.intro' },
  { id: 'onboarding', path: '/dev/onboarding.html', title: 'dev.onboarding', description: 'dev.onboarding.text' },
  { id: 'looks', path: '/dev/looks.html', legacy: '/looks.html', title: 'dev.looks', description: 'dev.looks.text' },
  { id: 'planets', path: '/dev/planets.html', title: 'dev.planets', description: 'dev.planets.text' },
  { id: 'suns', path: '/dev/suns.html', title: 'dev.suns', description: 'dev.suns.text' },
  { id: 'presets', path: '/dev/presets.html', legacy: '/preset-gallery.html', title: 'dev.presets', description: 'dev.presets.text' },
  { id: 'daily', path: '/dev/daily.html', legacy: '/daily.html', title: 'dev.daily', description: 'dev.daily.text' },
  { id: 'marks', path: '/dev/marks.html', legacy: '/marks.html', title: 'dev.marks', description: 'dev.marks.text' },
  { id: 'pwa', path: '/dev/pwa.html', legacy: '/pwa.html', title: 'dev.pwa', description: 'dev.pwa.text' },
  { id: 'briefing', path: '/dev/briefing.html', legacy: '/briefing.html', title: 'dev.briefing', description: 'dev.briefing.text' },
  { id: 'aim', path: '/dev/aim.html', legacy: '/debug-aim.html', title: 'dev.aim', description: 'dev.aim.text', debugAim: true },
  { id: 'results', path: '/dev/results.html', legacy: '/tests/browser/results.html', title: 'dev.results', description: 'dev.results.text' },
] as const;
export type DevPage = typeof DEV_PAGES[number];
