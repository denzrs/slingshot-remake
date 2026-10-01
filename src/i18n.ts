/** Tiny UI translation layer: German and English, switchable at runtime. */

export type Lang = 'de' | 'en';

export const LANGS: readonly Lang[] = ['de', 'en'];

const en = {
  // — static page (index.html) —
  'static.description': 'Slingshot – up to six spaceships, a few planets, a black hole and lots of gravity.',
  'static.canvas': 'Playfield',
  'static.clipSave': 'Save clip',
  'static.rotate': 'Rotate your device to landscape – the playfield gets bigger.',

  // — common —
  'common.on': 'On',
  'common.off': 'Off',
  'common.back': 'Back',
  'common.mainMenu': 'Main menu',
  'common.settings': 'Settings',
  'common.players': 'Players',
  'common.help': 'How to play',
  'common.language': 'Language',
  'common.fire': 'Fire',
  'common.ready': 'Ready',
  'common.next': 'Next',
  'common.skip': 'Skip',
  'common.space': 'Space',
  'common.ctrl': 'Ctrl',

  // — title screen —
  'title.eyebrow': 'Gravity duel for two to six',
  'title.lede': 'Spaceships, with planets in between. Every shot follows gravity – read your old trails and feel your way towards the hit.',
  'title.menuLabel': 'Main menu',
  'title.keys': '↑ ↓ select · Enter confirm',
  'mode.classic': 'Classic',
  'mode.classic.hint': 'Take turns firing, like the original',
  'mode.horizon': 'Event Horizon',
  'mode.horizon.hint': 'Volleys, a growing black hole, trick-shot combos',
  'lineup.human.one': 'human',
  'lineup.human.other': 'humans',
  'lineup.cpu.one': 'CPU',
  'lineup.cpu.other': 'CPUs',
  'lineup.teams': '{n} teams',

  // — pause —
  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.newGame': 'New game',

  // — players —
  'players.player': 'Player {n}',
  'players.note': 'Up to six ships. All humans take turns at this keyboard. Applies from the next game.',
  'players.mode': 'Game mode',
  'players.ffa': 'Free for all',
  'players.teams': '{n} teams',
  'players.teamOf': 'Player {n} · team',
  'players.teamNote': 'Teams need at least three ships spread over two teams – otherwise it is free for all.',
  'team.0': 'Ember',
  'team.1': 'Frost',
  'team.2': 'Nebula',
  'team.name': 'Team {team}',
  'seat.human': 'Human',
  'seat.easy': 'CPU easy',
  'seat.medium': 'CPU medium',
  'seat.hard': 'CPU hard',
  'cpu.easy': 'easy',
  'cpu.medium': 'medium',
  'cpu.hard': 'hard',

  // — settings —
  'settings.note':
    'Planet count and invisible planets apply from the next round, the round count from the next game. In Event Horizon, shots always bounce off the edge and planets stay visible.',
  'settings.rounds': 'Rounds per game',
  'settings.endless': 'Endless',
  'settings.maxPlanets': 'Max. planets',
  'settings.invisible': 'Invisible planets',
  'settings.bounce': 'Reflective edges',
  'settings.fixedPower': 'Fixed shot power',
  'settings.shotTime': 'Max. flight time',
  'settings.contours': 'Gravity lines',
  'settings.particles': 'Particles',
  'settings.sound': 'Sound',
  'settings.fullscreen': 'Fullscreen',
  'settings.seconds': '{n} s',

  // — help —
  'help.classic.title': 'Classic',
  'help.classic.body':
    'You fire at the other ships in turn. Every planet pulls the shot towards it – big ones harder than small ones. A ship that gets hit is out for the round; the round ends when only one ship is left. Your shots stay on screen as trails: the latest one solid, older ones dotted.',
  'help.teams.title': 'Teams',
  'help.teams.body':
    'With three or more ships you can play in two or three teams (Players menu). Teams share a colour family, start grouped together and take turns alternately. Friendly fire is on and costs {penalty} points. The round ends when only one team is left; every member of the winning team gets {bonus} points, even those already shot down. The team with the highest total wins the match.',
  'help.horizon.title': 'Event Horizon',
  'help.horizon.body':
    'Everyone aims in turn – humans get {seconds} seconds each – and then all shots fly at once. Projectiles that meet cancel each other out. After every volley the black hole in the middle grows towards the red ring, eats planets and pulls every ship a little closer. Touch the horizon and you are gone.',
  'help.key.rotate': 'Rotate ship',
  'help.key.power': 'Change shot power',
  'help.key.fire': 'Fire or "Ready" (Space works too)',
  'help.key.large': 'large steps (×10)',
  'help.key.small': 'small steps (×0.1)',
  'help.key.tiny': 'very small steps (×0.01)',
  'help.key.dragName': 'Drag',
  'help.key.drag': 'aim with mouse or finger on the playfield',
  'help.key.next': 'next round, skip killcam',
  'help.key.clip': 'save the last killcam as a video',
  'help.key.menu': 'Menu',
  'help.key.fullscreen': 'Fullscreen',
  'help.key.or': ' or ',
  'help.scoring.title': 'Scoring',
  'help.scoring.classic':
    'In Classic a kill is worth up to 1500 points: the fewer shots you need in the round and the less power the hit has, the more. With three or more players the last survivor gets {survivor} points. Hitting yourself costs {selfHit} points.',
  'help.scoring.horizon':
    'In Event Horizon a kill is worth base points times combo. Every volley survived brings {volley}, the last one in orbit {orbit} points. Combos stack:',

  // — trick shots —
  'style.swingby': 'Swing-by',
  'style.bank': 'Bank shot',
  'style.graze': 'Graze',
  'style.photon': 'Photon ring',
  'style.airtime': 'Airtime',
  'style.swingby.text': "a planet's gravity bends the shot by more than 40°",
  'style.bank.text': 'bounce off the edge',
  'style.graze.text': 'less than 5 pixels above a planet surface',
  'style.photon.text': 'a full lap around the black hole',
  'style.airtime.text': 'hit after more than 6 seconds of flight',

  // — game over —
  'over.draw': 'Draw',
  'over.wins': '{name} wins',
  'over.label': 'Final standings',
  'over.after.one': 'Final standings after {n} round',
  'over.after.other': 'Final standings after {n} rounds',
  'over.rematch': 'Rematch',
  'over.teamWins': 'Team {team} wins',
  'over.teams': 'Teams',
  'over.players': 'Players',

  // — HUD —
  'hud.round': 'ROUND',
  'hud.volley': 'VOLLEY',
  'hud.angle': 'ANGLE',
  'hud.power': 'POWER',
  'hud.fixedSuffix': ' fixed',
  'hud.aiming': 'AIMING',
  'hud.ready': 'READY',
  'hud.turn': "{name}'S TURN",
  'hud.shotPower': 'Shot {n} · Power {power}',
  'hud.winsRound': '{name} wins the round',
  'hud.teamWinsRound': 'Team {team} wins the round',
  'hud.perMember': '+{n} for each member',
  'hud.friendlyFire': ' ✕ friendly fire ▸ ',
  'hud.noSurvivor': 'No ship survived',
  'hud.horizon': 'Horizon',
  'hud.selfHit': ' ✕ Self-hit  ',
  'hud.killcam': 'KILLCAM',
  'hud.recClip': 'REC · CLIP',
  'hud.skip': 'skip',
  'hud.saveClip': 'Save clip',
  'hud.touch.horizon': 'Drag to aim, then “Ready”',
  'hud.touch.classic': 'Drag on the playfield to aim',
  'hud.powerFixed': 'Power fixed',
  'hud.powerLabel': 'Power',
  'hud.rotate': 'rotate',
  'hud.stepSize': 'Step size',
  'hud.menu': 'Menu',
  'hud.thinking': '{name} is aiming …',
  'hud.cpusAiming': 'CPUs are aiming …',
  'hud.collapse': 'The horizon is growing …',
  'hud.finalStandings': 'Final standings',
  'hud.nextRound': 'Next round',
  'hud.saveKillcam': 'Save killcam as clip',

  // — round titles —
  'title.hit': 'HIT',
  'title.selfHit': 'SELF-HIT',
  'title.swallowed': 'SWALLOWED',
  'title.lastInOrbit': 'LAST IN ORBIT',
  'title.noneLeft': 'NONE LEFT',
  'title.teamWin': 'TEAM {team}',
  'title.friendlyFire': 'FRIENDLY FIRE',
  'notice.volley': 'VOLLEY!',
} as const;

export type Key = keyof typeof en;
type Dict = Record<Key, string>;
type Params = Record<string, string | number>;

const de: Dict = {
  'static.description': 'Slingshot – bis zu sechs Raumschiffe, ein paar Planeten, ein schwarzes Loch und viel Gravitation.',
  'static.canvas': 'Spielfeld',
  'static.clipSave': 'Clip speichern',
  'static.rotate': 'Dreh dein Gerät ins Querformat – dann wird das Spielfeld größer.',

  'common.on': 'An',
  'common.off': 'Aus',
  'common.back': 'Zurück',
  'common.mainMenu': 'Hauptmenü',
  'common.settings': 'Einstellungen',
  'common.players': 'Mitspieler',
  'common.help': 'Anleitung',
  'common.language': 'Sprache',
  'common.fire': 'Feuer',
  'common.ready': 'Bereit',
  'common.next': 'Weiter',
  'common.skip': 'Skip',
  'common.space': 'Leertaste',
  'common.ctrl': 'Strg',

  'title.eyebrow': 'Gravitationsduell für zwei bis sechs',
  'title.lede': 'Raumschiffe, dazwischen Planeten. Jeder Schuss folgt der Schwerkraft – lies deine alten Bahnen und tast dich an den Treffer heran.',
  'title.menuLabel': 'Hauptmenü',
  'title.keys': '↑ ↓ wählen · Enter bestätigen',
  'mode.classic': 'Klassisch',
  'mode.classic.hint': 'Abwechselnd schießen, wie im Original',
  'mode.horizon': 'Ereignishorizont',
  'mode.horizon.hint': 'Salven, ein wachsendes schwarzes Loch, Trick-Shot-Combos',
  'lineup.human.one': 'Mensch',
  'lineup.human.other': 'Menschen',
  'lineup.cpu.one': 'CPU',
  'lineup.cpu.other': 'CPUs',
  'lineup.teams': '{n} Teams',

  'pause.title': 'Pause',
  'pause.resume': 'Weiterspielen',
  'pause.newGame': 'Neues Spiel',

  'players.player': 'Spieler {n}',
  'players.note': 'Bis zu sechs Schiffe. Alle Menschen spielen abwechselnd an dieser Tastatur. Gilt ab dem nächsten Spiel.',
  'players.mode': 'Spielmodus',
  'players.ffa': 'Jeder gegen jeden',
  'players.teams': '{n} Teams',
  'players.teamOf': 'Spieler {n} · Team',
  'players.teamNote': 'Teams brauchen mindestens drei Schiffe in zwei verschiedenen Teams – sonst heißt es jeder gegen jeden.',
  'team.0': 'Glut',
  'team.1': 'Frost',
  'team.2': 'Nebel',
  'team.name': 'Team {team}',
  'seat.human': 'Mensch',
  'seat.easy': 'CPU leicht',
  'seat.medium': 'CPU mittel',
  'seat.hard': 'CPU schwer',
  'cpu.easy': 'leicht',
  'cpu.medium': 'mittel',
  'cpu.hard': 'schwer',

  'settings.note':
    'Planetenzahl und unsichtbare Planeten gelten ab der nächsten Runde, die Rundenzahl ab dem nächsten Spiel. Im Ereignishorizont prallen Schüsse immer am Rand ab, und Planeten bleiben sichtbar.',
  'settings.rounds': 'Runden pro Spiel',
  'settings.endless': 'Endlos',
  'settings.maxPlanets': 'Max. Planeten',
  'settings.invisible': 'Unsichtbare Planeten',
  'settings.bounce': 'Reflektierende Ränder',
  'settings.fixedPower': 'Feste Schusskraft',
  'settings.shotTime': 'Max. Flugzeit',
  'settings.contours': 'Gravitationslinien',
  'settings.particles': 'Partikel',
  'settings.sound': 'Ton',
  'settings.fullscreen': 'Vollbild',
  'settings.seconds': '{n} s',

  'help.classic.title': 'Klassisch',
  'help.classic.body':
    'Ihr schießt reihum auf die anderen Schiffe. Jeder Planet zieht den Schuss an – große stärker als kleine. Wer getroffen wird, ist für die Runde raus; die Runde endet, wenn nur noch ein Schiff übrig ist. Eure Schüsse bleiben als Spur stehen: der letzte durchgezogen, ältere gepunktet.',
  'help.teams.title': 'Teams',
  'help.teams.body':
    'Ab drei Schiffen könnt ihr in zwei oder drei Teams spielen (Menü „Mitspieler“). Ein Team teilt sich eine Farbfamilie, startet gruppiert und schießt abwechselnd mit den anderen Teams. Teambeschuss ist an und kostet {penalty} Punkte. Die Runde endet, wenn nur noch ein Team übrig ist; jedes Mitglied des Siegerteams bekommt {bonus} Punkte, auch wer schon abgeschossen wurde. Am Ende gewinnt das Team mit der höchsten Summe.',
  'help.horizon.title': 'Ereignishorizont',
  'help.horizon.body':
    'Alle zielen nacheinander – Menschen haben je {seconds} Sekunden – und dann fliegen alle Schüsse gleichzeitig. Geschosse, die sich treffen, löschen sich aus. Nach jeder Salve wächst das schwarze Loch in der Mitte bis zum roten Ring, frisst Planeten und zieht alle Schiffe ein Stück zu sich. Wer den Horizont berührt, ist weg.',
  'help.key.rotate': 'Schiff drehen',
  'help.key.power': 'Schusskraft ändern',
  'help.key.fire': 'Feuer bzw. „Bereit“ (auch Leertaste)',
  'help.key.large': 'große Schritte (×10)',
  'help.key.small': 'kleine Schritte (×0,1)',
  'help.key.tiny': 'sehr kleine Schritte (×0,01)',
  'help.key.dragName': 'Ziehen',
  'help.key.drag': 'mit Maus oder Finger auf dem Spielfeld zielen',
  'help.key.next': 'nächste Runde, Killcam überspringen',
  'help.key.clip': 'letzte Killcam als Video speichern',
  'help.key.menu': 'Menü',
  'help.key.fullscreen': 'Vollbild',
  'help.key.or': ' oder ',
  'help.scoring.title': 'Punkte',
  'help.scoring.classic':
    'Klassisch bringt ein Abschuss bis zu 1500 Punkte: je weniger Schüsse ihr in der Runde braucht und je weniger Kraft der Treffer hat, desto mehr. Ab drei Spielern gibt es {survivor} Punkte für den letzten Überlebenden. Ein Eigentreffer kostet {selfHit} Punkte.',
  'help.scoring.horizon':
    'Im Ereignishorizont zählt ein Abschuss Grundpunkte mal Combo. Jede überlebte Salve bringt {volley}, der Letzte im Orbit {orbit} Punkte. Combos stapeln sich:',

  'style.swingby': 'Swing-by',
  'style.bank': 'Bande',
  'style.graze': 'Streifschuss',
  'style.photon': 'Photonenring',
  'style.airtime': 'Flugzeit',
  'style.swingby.text': 'die Schwerkraft eines Planeten lenkt den Schuss um mehr als 40° ab',
  'style.bank.text': 'Abprall an der Bande',
  'style.graze.text': 'keine 5 Pixel über einer Planetenoberfläche',
  'style.photon.text': 'eine volle Runde um das schwarze Loch',
  'style.airtime.text': 'Treffer nach mehr als 6 Sekunden Flug',

  'over.draw': 'Unentschieden',
  'over.wins': '{name} gewinnt',
  'over.label': 'Endstand',
  'over.after.one': 'Endstand nach {n} Runde',
  'over.after.other': 'Endstand nach {n} Runden',
  'over.rematch': 'Revanche',
  'over.teamWins': 'Team {team} gewinnt',
  'over.teams': 'Teams',
  'over.players': 'Spieler',

  'hud.round': 'RUNDE',
  'hud.volley': 'SALVE',
  'hud.angle': 'WINKEL',
  'hud.power': 'KRAFT',
  'hud.fixedSuffix': ' fix',
  'hud.aiming': 'ZIELT',
  'hud.ready': 'BEREIT',
  'hud.turn': '{name} IST DRAN',
  'hud.shotPower': '{n}. Schuss · Kraft {power}',
  'hud.winsRound': '{name} gewinnt die Runde',
  'hud.teamWinsRound': 'Team {team} gewinnt die Runde',
  'hud.perMember': '+{n} je Mitglied',
  'hud.friendlyFire': ' ✕ Teambeschuss ▸ ',
  'hud.noSurvivor': 'Kein Schiff hat überlebt',
  'hud.horizon': 'Horizont',
  'hud.selfHit': ' ✕ Eigentreffer  ',
  'hud.killcam': 'KILLCAM',
  'hud.recClip': 'REC · CLIP',
  'hud.skip': 'überspringen',
  'hud.saveClip': 'Clip speichern',
  'hud.touch.horizon': 'Ziehen zum Zielen, dann „Bereit“',
  'hud.touch.classic': 'Zum Zielen auf dem Spielfeld ziehen',
  'hud.powerFixed': 'Kraft fix',
  'hud.powerLabel': 'Kraft',
  'hud.rotate': 'drehen',
  'hud.stepSize': 'Schrittweite',
  'hud.menu': 'Menü',
  'hud.thinking': '{name} zielt …',
  'hud.cpusAiming': 'CPUs zielen …',
  'hud.collapse': 'Der Horizont wächst …',
  'hud.finalStandings': 'Endstand',
  'hud.nextRound': 'Nächste Runde',
  'hud.saveKillcam': 'Killcam als Clip speichern',

  'title.hit': 'TREFFER',
  'title.selfHit': 'EIGENTREFFER',
  'title.swallowed': 'VERSCHLUCKT',
  'title.lastInOrbit': 'LETZTER IM ORBIT',
  'title.noneLeft': 'KEINER ÜBRIG',
  'title.teamWin': 'TEAM {team}',
  'title.friendlyFire': 'TEAMBESCHUSS',
  'notice.volley': 'SALVE!',
};

const DICTS: Record<Lang, Dict> = { de, en };

/** Keys that come in a `.one` / `.other` pair. */
export type PluralKey = 'lineup.human' | 'lineup.cpu' | 'over.after';

let current: Lang = 'de';

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/** First visit: follow the browser's language, German for German speakers and English for everyone else. */
export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function isLang(v: unknown): v is Lang {
  return v === 'de' || v === 'en';
}

export function t(key: Key, params?: Params): string {
  const text = DICTS[current][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Pick the `.one` or `.other` variant of a key for a count. */
export function tn(key: PluralKey, n: number, params?: Params): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...params });
}

/** Number with a fixed number of decimals in the current language: 12,50 / 12.50 */
export function fmt(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return current === 'de' ? s.replace('.', ',') : s;
}

/** Plain number without padding zeros: 1,25 / 1.25 */
export function fmtNum(n: number): string {
  const s = String(n);
  return current === 'de' ? s.replace('.', ',') : s;
}

/** Push the current language into the static HTML shell (index.html). */
export function applyStaticTexts(): void {
  document.documentElement.lang = current;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('static.description'));
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  });
}
