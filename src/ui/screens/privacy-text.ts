import type { Lang } from '../../platform/i18n';

/**
 * The text of the privacy page. It describes what the code does today (see `docs/multiplayer.md`, "Match statistics" and
 * "Daily leaderboard", and `src/data/browserId.ts`); a change to what is stored or sent has to change this text too.
 *
 * It lives here and not in `i18n.ts` because it is a long document, not a label; the page's title and the footer link are in
 * `i18n.ts` as usual.
 */
export interface PrivacySection {
  title: string;
  /** Paragraphs; a line starting with "- " is a list item and consecutive ones form one list. `[text](url)` is a link. */
  body: string[];
}

export interface PrivacyText {
  updated: string;
  sections: PrivacySection[];
}

const de: PrivacyText = {
  updated: 'Stand: 17. November 2026',
  sections: [
    {
      title: 'Kurz gesagt',
      body: [
        '- Kein Konto, keine Cookies, keine Werbung, kein Tracking und keine Analyse-Dienste.',
        '- Einstellungen und Spielstände bleiben in deinem Browser.',
        '- Nur wenn du online spielst, die Tagesrangliste nutzt oder die Statistik ansiehst, sprichst du mit unserem Server (dem „Relay“). Was dort ankommt und was gespeichert wird, steht unten.',
        '- Die Seite selbst wird von GitHub Pages ausgeliefert. GitHub sieht deshalb deine IP-Adresse, wenn du die Seite aufrufst.',
      ],
    },
    {
      title: '1. Verantwortlicher',
      body: [
        'Slingshot wird betrieben von [denzrs](https://github.com/denzrs) und [matthias-Q](https://github.com/matthias-Q).',
        'Kontakt für Datenschutzanfragen: [slingshotremake@gmail.com](mailto:slingshotremake@gmail.com)',
        'Slingshot ist ein Open-Source-Projekt ([Quelltext auf GitHub](https://github.com/denzrs/slingshot-remake)).',
      ],
    },
    {
      title: '2. Hosting der Webseite: GitHub Pages',
      body: [
        'Diese Seite wird über GitHub Pages ausgeliefert, einen Hosting-Dienst von GitHub (GitHub, Inc., USA, bzw. GitHub B.V., Niederlande – je nachdem, mit wem du den Dienst nutzt). Beim Aufruf der Seite verarbeitet GitHub technisch notwendige Verbindungsdaten: deine IP-Adresse, Datum und Uhrzeit, die angeforderte Datei, den Browsertyp und – falls übermittelt – die Seite, von der du kommst. Nach Angaben von GitHub werden solche Daten, darunter die IP-Adresse, auch aus Sicherheitsgründen protokolliert. Eine konkrete Speicherdauer nennt GitHub nicht.',
        'Auf diese Protokolle haben wir keinen Zugriff und keinen Einfluss. Wir bekommen von GitHub keine Besucherlisten und setzen die GitHub-Dienste nicht zur Reichweitenmessung ein.',
        'Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO: Unser berechtigtes Interesse ist, das Spiel sicher und zuverlässig im Netz anzubieten. Eine Übermittlung in die USA ist möglich; GitHub ist nach eigener Angabe unter dem EU-U.S. Data Privacy Framework zertifiziert. Mehr dazu in der Datenschutzerklärung von GitHub: docs.github.com/site-policy/privacy-policies/github-general-privacy-statement',
      ],
    },
    {
      title: '3. Was dein Browser lokal speichert',
      body: [
        'Slingshot setzt keine Cookies. Es nutzt den lokalen Speicher deines Browsers (localStorage), der nur auf deinem Gerät liegt und nicht automatisch an uns gesendet wird. Dort liegen:',
        '- deine Einstellungen (Sprache, Aussehen, Ton, Steuerung),',
        '- dein Anzeigename und die Lobby-Einstellungen für Online-Räume,',
        '- deine Ergebnisse der Tagesaufgabe (bestes Ergebnis, Versuche, Serie; die letzten 120 Tage),',
        '- eigene Regel-Vorlagen,',
        '- ob du die Einführung schon gesehen hast, ob der Installationshinweis weggeklickt wurde und ob das Chatfenster eingeklappt ist,',
        '- ein kurzzeitig zwischengespeicherter Satz Statistik-Fakten für das Menü,',
        '- eine zufällige Browser-Kennung (siehe Abschnitt 4).',
        'Außerdem legt ein Service Worker die Spieldateien im Browser-Cache ab, damit das Spiel offline läuft.',
        'Das ist technisch erforderlich, damit das Spiel deine Wünsche umsetzt (§ 25 Abs. 2 Nr. 2 TDDDG, Art. 6 Abs. 1 lit. b und f DSGVO); eine Einwilligung ist dafür nicht nötig. Du kannst alles unter Einstellungen → App-Daten löschen oder in deinen Browser-Einstellungen entfernen.',
      ],
    },
    {
      title: '4. Online spielen: das Relay',
      body: [
        'Für Online-Spiele, die Tagesrangliste und die Statistik verbindest du dich mit unserem Relay unter slingshot-relay.eu (verschlüsselt per TLS). Dabei sieht das Relay technisch deine IP-Adresse. Wenn „Statistik anzeigen“ eingeschaltet ist (Einstellungen → Statistik anzeigen), zeigt das Menü Zahlen aus dem Spiel und verbindet sich schon beim Anzeigen mit dem Relay, auch bevor du online spielst.',
        'Zum Schutz vor Missbrauch zählt das Relay Verbindungen pro Adresse. Das passiert nur im Arbeitsspeicher. Damit sich Leute hinter einer gemeinsamen Adresse (VPN, Mobilfunk) nicht gegenseitig aussperren, schickt dein Browser eine zufällige Kennung (128 Bit, ohne Bezug zu dir) mit; das Relay hält sie nur so lange im Arbeitsspeicher, wie die Begrenzung gilt, und schreibt sie nirgends auf.',
        'In einem Online-Raum gibt das Relay deinen Anzeigenamen, dein Symbol, Chat-Nachrichten und deine Spielzüge an die anderen im Raum weiter. Das ist für das Spiel nötig; die Nachrichten und Züge werden vom Relay nicht dauerhaft gespeichert. Wähle keinen Namen, der dich identifiziert, wenn du das nicht möchtest – andere im Raum sehen ihn.',
        'Das Relay läuft auf einem Server von IONOS SE in Deutschland. Wie IONOS Daten verarbeitet, steht in der [Datenschutzerklärung von IONOS](https://www.ionos.de/terms-gtc/datenschutzerklaerung/).',
        'Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Spielbetrieb) und lit. f (Schutz vor Missbrauch).',
      ],
    },
    {
      title: '5. Tagesrangliste',
      body: [
        'Die Rangliste ist freiwillig. Erst wenn du „Punktzahl posten“ drückst, gehen dein gewählter Name, deine Punktzahl und der Tag an das Relay und sind dort für alle sichtbar, die die Rangliste öffnen. Der beste Lauf des Tages wird außerdem mit deinem Namen und seinem Schuss (Zielrichtung, Stärke, Flugbahn) gespeichert; andere, die selbst gepostet haben, können ihn ansehen. Nimm am besten einen Spitznamen.',
        'Damit ein Anschluss pro Tag nur einen Eintrag hat, bildet das Relay aus deiner IP-Adresse und dem Tag einen Zufallswert (Hash) mit einem Schlüssel, der nur im Arbeitsspeicher liegt. Die IP-Adresse selbst wird dabei nicht gespeichert. Nach einem Neustart des Relays ist der Schlüssel weg.',
        'Einträge und Schüsse werden nach sieben Tagen automatisch gelöscht. Wenn du früher gelöscht werden möchtest, schreib uns (Abschnitt 8). Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO.',
      ],
    },
    {
      title: '6. Statistik der Online-Spiele',
      body: [
        'Um zu sehen, wie das Spiel gespielt wird (Rundenlänge, beliebte Regeln, Trefferquoten, wie oft CPUs gewinnen), speichert das Relay für Online-Spiele Zahlen zu Runden, Zügen und Schüssen. Gespeichert werden keine Namen, keine Chat-Nachrichten und keine IP-Adressen. Ein Raum erscheint nur als Zufallskennung.',
        'Damit gezählt werden kann, wie viele verschiedene Leute spielen, steht bei jedem Sitzplatz ein Pseudonym: ein Hash (HMAC-SHA256) aus IP-Adresse und Spielname mit einem Zufallsschlüssel, der jede Woche (sonntags, UTC) gewechselt wird. Weil der Schlüssel in derselben Datenbank liegt, ist das keine Anonymisierung, sondern eine Pseudonymisierung: Wer Zugriff auf die Datei hat, könnte eine bekannte Adresse und einen Namen dagegen prüfen. Es gibt keinen Weg von diesem Pseudonym zu einem Namen auf der Rangliste; beide nutzen getrennte Schlüssel.',
        'Auch ein lokal gespieltes Spiel (gegen CPUs oder an einer Tastatur) wird, wenn es zu Ende gespielt wurde und diese Fassung ein Relay hat, einmalig an das Relay gemeldet: Regeln, Sitzplätze und Rundenergebnisse, ohne Namen; die Person ist hier nur ein Hash der IP-Adresse. Abgebrochene Spiele werden nicht gemeldet. Die Tagesaufgabe zählt nicht dazu.',
        'Die Zahlen werden nach 365 Tagen gelöscht; Sicherungskopien der Datenbank bleiben bis zu 14 Tage länger. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Interesse an Spielbalance und Weiterentwicklung). Du kannst nach Art. 21 DSGVO widersprechen (Abschnitt 8). Weil die Zeilen kein Name tragen, können wir sie nur dann deiner Person zuordnen, wenn du uns deine IP-Adresse und deinen Spielnamen nennst.',
      ],
    },
    {
      title: '7. Externe Inhalte',
      body: [
        'Schriften und alle Spieldateien kommen von der Seite selbst; es werden keine Schriften, Skripte oder Bilder von Google oder Content-Delivery-Netzen nachgeladen.',
        'Links im Menü, etwa zu „Buy me a coffee“ oder GitHub, laden nichts nach. Erst wenn du sie anklickst, gelangst du auf die Seite des Anbieters, wo dessen Datenschutzerklärung gilt.',
      ],
    },
    {
      title: '8. Deine Rechte',
      body: [
        'Du hast die Rechte nach der DSGVO: auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib dazu an die oben genannte E-Mail-Adresse. Außerdem kannst du dich bei der Datenschutz-Aufsichtsbehörde beschweren.',
        'Du musst keine Daten angeben, um offline zu spielen. Eine automatisierte Entscheidungsfindung findet nicht statt.',
      ],
    },
    {
      title: '9. Änderungen',
      body: [
        'Ändert sich, was Slingshot speichert oder sendet, ändern wir diese Seite. Den aktuellen Stand siehst du oben.',
      ],
    },
  ],
};

const en: PrivacyText = {
  updated: 'Last updated: 17 November 2026',
  sections: [
    {
      title: 'In short',
      body: [
        '- No account, no cookies, no ads, no tracking and no analytics services.',
        '- Your settings and results stay in your browser.',
        '- Only when you play online, use the daily leaderboard or open the statistics do you talk to our server (the "relay"). What arrives there and what is stored is described below.',
        '- The site itself is served by GitHub Pages, so GitHub sees your IP address when you open it.',
      ],
    },
    {
      title: '1. Controller',
      body: [
        'Slingshot is run by [denzrs](https://github.com/denzrs) and [matthias-Q](https://github.com/matthias-Q).',
        'Contact for privacy requests: [slingshotremake@gmail.com](mailto:slingshotremake@gmail.com)',
        'Slingshot is an open-source project ([source on GitHub](https://github.com/denzrs/slingshot-remake)).',
      ],
    },
    {
      title: '2. Hosting of the website: GitHub Pages',
      body: [
        'This site is served by GitHub Pages, a hosting service by GitHub (GitHub, Inc., USA, or GitHub B.V., Netherlands, depending on who you use the service with). When you open the site, GitHub processes the connection data that is technically needed: your IP address, date and time, the requested file, your browser type and, if sent, the page you came from. According to GitHub, such data, including the IP address, is also logged for security reasons. GitHub does not name a specific retention period.',
        'We have no access to these logs and no influence over them. GitHub gives us no visitor lists, and we do not use GitHub for audience measurement.',
        'The legal basis is Art. 6(1)(f) GDPR: our legitimate interest in offering the game securely and reliably online. A transfer to the USA is possible; GitHub states that it is certified under the EU-U.S. Data Privacy Framework. More in GitHub\'s privacy statement: docs.github.com/site-policy/privacy-policies/github-general-privacy-statement',
      ],
    },
    {
      title: '3. What your browser stores locally',
      body: [
        'Slingshot sets no cookies. It uses your browser\'s local storage (localStorage), which stays on your device and is not sent to us automatically. It holds:',
        '- your settings (language, look, sound, controls),',
        '- your display name and the lobby settings for online rooms,',
        '- your daily challenge results (best score, attempts, streak; the last 120 days),',
        '- your own rule presets,',
        '- whether you have seen the introduction, dismissed the install hint, and whether the chat panel is collapsed,',
        '- a briefly cached set of statistics facts for the menu,',
        '- a random browser identifier (see section 4).',
        'A service worker also keeps the game\'s files in the browser cache so that the game works offline.',
        'This is technically necessary for the game to do what you ask (§ 25(2) no. 2 TDDDG, Art. 6(1)(b) and (f) GDPR); no consent is required. You can remove it all under Settings → Delete app data or in your browser settings.',
      ],
    },
    {
      title: '4. Playing online: the relay',
      body: [
        'For online games, the daily leaderboard and the statistics you connect to our relay at slingshot-relay.eu (encrypted with TLS). The relay technically sees your IP address. If “Show statistics” is on (Settings → Show statistics), the menu shows numbers from the game and connects to the relay as soon as it is shown, before you play online.',
        'To protect against abuse, the relay counts connections per address, in memory only. So that people behind a shared address (VPN, mobile network) do not lock each other out, your browser sends a random identifier (128 bits, unrelated to you); the relay holds it in memory only for as long as a limit applies and writes it down nowhere.',
        'In an online room the relay passes your display name, symbol, chat messages and moves to the others in the room. That is needed for the game; the relay does not keep messages or moves permanently. Do not choose a name that identifies you if you would rather not: others in the room see it.',
        'The relay runs on a server of IONOS SE in Germany. How IONOS processes data is described in [IONOS\' privacy policy](https://www.ionos.de/terms-gtc/datenschutzerklaerung/).',
        'The legal basis is Art. 6(1)(b) GDPR (running the game) and (f) (protection against abuse).',
      ],
    },
    {
      title: '5. Daily leaderboard',
      body: [
        'The leaderboard is voluntary. Only when you press "Post score" do your chosen name, your score and the day go to the relay, where everyone who opens the leaderboard can see them. The day\'s best run is also kept with your name and its shot (angle, power, flight path); others who have posted themselves can watch it. A nickname is best.',
        'So that one connection has only one entry per day, the relay forms a random-looking value (a hash) from your IP address and the day with a key that is held in memory only. The IP address itself is not stored. After a restart of the relay the key is gone.',
        'Entries and shots are deleted automatically after seven days. If you want to be deleted sooner, write to us (section 8). Legal basis: Art. 6(1)(b) and (f) GDPR.',
      ],
    },
    {
      title: '6. Statistics of online games',
      body: [
        'To see how the game is played (round length, popular rules, hit rates, how often CPUs win), the relay stores numbers about rounds, turns and shots of online games. No names, no chat messages and no IP addresses are stored. A room appears only as a random identifier.',
        'So that it can count how many different people play, each seat carries a pseudonym: a hash (HMAC-SHA256) of the IP address and the player name with a random key that is replaced every week (Sundays, UTC). Because the key sits in the same database, this is pseudonymisation, not anonymisation: whoever has the file could test a known address and name against it. There is no way from this pseudonym to a name on the leaderboard; they use separate keys.',
        'A game played locally (against CPUs or on one keyboard) is also reported to the relay once, if it was played to the end and this build has a relay: the rules, who sat where and the round results, without names; the person is only a hash of the IP address. Abandoned games are not reported. The daily challenge is not included.',
        'The numbers are deleted after 365 days; backup copies of the database remain for up to 14 days longer. The legal basis is Art. 6(1)(f) GDPR (interest in game balance and development). You can object under Art. 21 GDPR (section 8). Because the rows carry no name, we can only link them to you if you tell us your IP address and your player name.',
      ],
    },
    {
      title: '7. External content',
      body: [
        'Fonts and all game files come from the site itself; no fonts, scripts or images are loaded from Google or content delivery networks.',
        'Links in the menu, such as "Buy me a coffee" or GitHub, load nothing. Only when you click them do you reach the provider\'s site, where its privacy policy applies.',
      ],
    },
    {
      title: '8. Your rights',
      body: [
        'You have the rights under the GDPR: access, rectification, erasure, restriction of processing, data portability and objection. Write to the email address above. You can also complain to the data protection supervisory authority.',
        'You do not have to provide any data to play offline. There is no automated decision-making.',
      ],
    },
    {
      title: '9. Changes',
      body: ['If what Slingshot stores or sends changes, we change this page. The current version is shown at the top.'],
    },
  ],
};

export const PRIVACY_TEXT: Record<Lang, PrivacyText> = { de, en };
