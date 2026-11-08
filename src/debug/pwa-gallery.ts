import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './looks-gallery.css';
import './pwa-gallery.css';

/**
 * Dev-only page (`/dev/pwa.html`, never part of a build): the three hints of the installed app on the real menu, each in a frame of
 * the game itself (`/?preview=pwa-<hint>`, which shows that hint whatever the browser says and remembers nothing). Phone width and
 * desktop width, since the strip sits over the foot of the menu and the two lay it out differently.
 */

interface Shot {
  hint: 'android' | 'ios' | 'update' | 'outdated';
  title: string;
  note: string;
}

const SHOTS: Shot[] = [
  { hint: 'android', title: 'Installieren · Android und Desktop', note: 'Der Browser hat seinen Install-Dialog angeboten (beforeinstallprompt; Chrome und Edge, auch am Desktop): Button und Schließen. Das Logo wechselt mit einem Install-Symbol ab (Pfeil in eine Schale). Nur im Hauptmenü, nicht in der installierten App, nach „Schließen“ 30 Tage nicht mehr.' },
  { hint: 'ios', title: 'Installieren · iOS', note: 'iOS hat keinen Install-Dialog, also nur der Weg von Hand (Teilen-Symbol → Zum Home-Bildschirm). Gleiche Bedingungen, ohne Button.' },
  { hint: 'outdated', title: 'Veraltet · online', note: 'Das Relay hat den Client abgewiesen, weil er für ein älteres Protokoll gebaut ist (Versionsabgleich, ?v= am Relay). Erscheint überall außerhalb eines Matches, auch in der Lobby. „Neu laden“ holt die neueste Version: eine wartende wird eingeschaltet, sonst sucht der Service Worker eine; ein einfaches Neuladen würde den Cache zeigen.' },
  { hint: 'update', title: 'Neue Version', note: 'Ein neuer Service Worker wartet. Nur im Hauptmenü, nie im Match: „Neu laden“ schaltet um und lädt die Seite neu. Das Logo wechselt mit einem Pfeil-Symbol ab, wie bei iOS mit dem Teilen-Symbol. Hat Vorrang vor dem Installieren und lässt sich nicht schließen.' },
];

const frame = (hint: Shot['hint'], width: number, height: number): string =>
  `<iframe title="${hint} ${width}" src="/?preview=pwa-${hint}" width="${width}" height="${height}" loading="lazy"></iframe>`;

const root = document.createElement('div');
root.className = 'wrap';
root.innerHTML = `
  <header>
    <h1>App-Hinweise</h1>
    <p class="note">Was das Spiel als installierte App oder Web-App einblendet. Jeder Rahmen ist das echte Menü; der Hinweis ist dort erzwungen, und „Schließen“ merkt sich hier nichts. Die Texte folgen der Spracheinstellung des Spiels.</p>
  </header>
  <main>
    <section><h2>Handy <small>375 × 700</small></h2><div class="phones"></div></section>
    <section><h2>Desktop <small>Install- und Update-Hinweis, 960 × 600 und 1280 × 720</small></h2><div class="desktop"></div></section>
  </main>`;
document.body.append(root);

const phones = root.querySelector('.phones')!;
for (const { hint, title, note } of SHOTS) {
  const fig = document.createElement('figure');
  fig.innerHTML = `<div class="phone">${frame(hint, 375, 700)}</div><figcaption><b>${title}</b><span>${note}</span></figcaption>`;
  phones.append(fig);
}
const desktop = root.querySelector('.desktop')!;
const DESKTOP: { hint: Shot['hint']; width: number; height: number; title: string; note: string }[] = [
  { hint: 'android', width: 960, height: 600, title: 'Installieren · Desktop', note: 'Chrome und Edge bieten auch am Desktop an, das Spiel als App zu installieren. Hier eine kleine, ruhige Karte oben rechts: kein Glow, kein Pulsieren, gleiche Bedingungen und Schließen wie auf dem Handy (30 Tage Pause).' },
  { hint: 'outdated', width: 960, height: 600, title: 'Veraltet · Desktop', note: 'Wie der Update-Hinweis, mit eigenem Text.' },
  { hint: 'update', width: 960, height: 600, title: 'Neue Version · Desktop', note: 'Gleiche Größe wie der Install-Hinweis, aber mit Glow. Oben rechts, wo das Menü leer ist (auf dem Handy am Fuß).' },
  { hint: 'update', width: 1280, height: 720, title: 'Neue Version · breit', note: 'Rahmen und Fußzeile des Menüs bleiben frei.' },
];
for (const { hint, width, height, title, note } of DESKTOP) {
  const fig = document.createElement('figure');
  fig.innerHTML = `<div class="screen">${frame(hint, width, height)}</div><figcaption><b>${title}</b><span>${note}</span></figcaption>`;
  desktop.append(fig);
}
