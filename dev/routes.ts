import { DEV_PAGES } from './pages';

type Route = { status: 307; location: string } | { status: 404; message: string };

/** Dev HTML never falls through to the game's SPA, including on the production preview server. */
export function devRoute(url: string, development: boolean, debugAim: boolean): Route | null {
  const queryAt = url.indexOf('?');
  const path = queryAt < 0 ? url : url.slice(0, queryAt);
  const query = queryAt < 0 ? '' : url.slice(queryAt);
  const moved = (page: typeof DEV_PAGES[number]): boolean => 'legacy' in page && page.legacy === path;
  const page = DEV_PAGES.find((page) => page.path === path || moved(page) || (page.id === 'home' && (path === '/dev' || path === '/dev/index.html')));
  const inDev = path === '/dev' || path.startsWith('/dev/');
  if (!page && !inDev && !path.startsWith('/debug-aim')) return null;
  if (!development) return { status: 404, message: 'Development pages are available only with npm run dev.' };
  if ((page?.id === 'aim' || path.startsWith('/debug-aim')) && !debugAim) {
    return { status: 404, message: 'Aim predictor disabled: start with DEBUG_AIM=1 npm run dev.' };
  }
  if (page && (moved(page) || path === '/dev')) return { status: 307, location: page.path + query };
  if (!page && (path.endsWith('.html') || !path.includes('.'))) return { status: 404, message: 'Unknown development page.' };
  return null;
}
