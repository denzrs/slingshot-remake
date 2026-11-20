import type { Lang } from '../../platform/i18n';
import type { PrivacySection } from './privacy-text';

/**
 * The text of the terms of use. It covers the online features only (the relay: online rooms, chat, names, the daily board and the
 * statistics); offline play has no rules beyond the licence. It describes what the code does today (see `docs/multiplayer.md`
 * and `server/src/protocol.rs` for the name and chat filter, `server/src/room/chat.rs` for the chat limit): a change to those
 * has to change this text too.
 *
 * Shares the section shape with the privacy page (`PrivacySection`), so both pages render through the same code.
 */
export interface TermsText {
  updated: string;
  sections: PrivacySection[];
}

const de: TermsText = {
  updated: 'Stand: 20. November 2026',
  sections: [
    {
      title: 'Geltungsbereich',
      body: [
        'Diese Nutzungsbedingungen gelten für die Online-Funktionen von Slingshot: Online-Räume, Chat, Spielernamen, die Tagesrangliste und die Statistik. Offline spielen – gegen CPUs oder an einem Gerät – ist davon nicht berührt und hat keine Bedingungen außer der Lizenz des Quellcodes (GPL-3.0).',
        'Mit dem Beitritt zu einem Online-Raum, dem Posten eines Ergebnisses oder dem Öffnen der Statistik erkennst du diese Bedingungen an. Wenn du sie nicht akzeptierst, schalte die Online-Funktionen unter Einstellungen → Online-Funktionen ab.',
      ],
    },
    {
      title: 'Fair spielen',
      body: [
        'Du darfst im Online-Spiel, auf der Tagesrangliste und in der Statistik nicht betrügen. Insbesondere ist untersagt:',
        '- das Spiel so zu verändern, dass Züge, Treffer, Punkte oder Ergebnisse gefälscht werden, auch wenn du nur den eigenen Client veränderst',
        '- Skripte, Bots oder Automatisierung, die Züge im Online-Spiel oder auf der Tagesrangliste für dich abgeben,',
        '- einen Tagesrangliste-Eintrag, der nicht von dir gespielt wurde, oder eine Punktzahl, die du nicht erreicht hast, zu posten,',
        '- Verbindungen zum Relay zu fluten, Limits zu umgehen (etwa durch wechselnde Browser-Kennungen oder Adressen) oder Statistiken mit Phantomrunden zu füllen,',
        '- Absprachen, bei denen Spieler sich gegenseitig Ergebnisse oder Wetten manipulieren.',
        'Ein Spiel, das durch einen Fehler oder eine Verbindungsstörung abbricht, ist kein Verstoß. Die Spielregeln gelten für alle Mitspieler im Raum gleich.',
      ],
    },
    {
      title: 'Umgang miteinander',
      body: [
        'Sei fair und respektvoll. Im Chat, bei Spielernamen, Raumnamen und auf der Tagesrangliste sind unzulässig:',
        '- Beleidigungen, Mobbing, Drohungen und Belästigung von anderen Spielern',
        '- Hassrede, also Inhalte, die Menschen wegen Herkunft, Religion, Geschlecht, sexueller Orientierung, Behinderung oder ähnlichem abwerten',
        '- Vulgäre, pornografische oder sexuell anzügliche Inhalte und gewaltverherrlichende Darstellungen',
        '- Namen, Symbole oder Texte, die andere täuschen sollen (etwa mit dem Namen einer anderen Person oder einer Moderation)',
        '- persönliche Daten anderer, Werbung, Spam, Links zu Schadsoftware oder Aufforderungen, außerhalb des Spiels Kontakt aufzunehmen oder Geld zu schicken',
        'Der Filter des Relays ersetzt Schimpfwörter in Chat-Nachrichten durch Sternchen und lehnt Namen mit eindeutig anstößigen Wörtern ab. Das ist eine Hilfe, aber kein vollständiger Schutz: Auch Umgehungen und Anspielungen sind unzulässig, und du bist für deine Nachrichten verantwortlich.',
        'Chat-Nachrichten sind nicht vertraulich. Alle im Raum sehen sie, und der Chat ist auf wenige Nachrichten pro Zeitraum begrenzt.',
      ],
    },
    {
      title: 'Was wir tun können',
      body: [
        'Wenn jemand gegen diese Bedingungen verstößt, können wir nach eigenem Ermessen handeln, insbesondere:',
        '- Nachrichten oder Namen entfernen oder ersetzen',
        '- einen Online-Raum schließen oder Spieler daraus entfernen',
        '- Verbindungen zum Relay von einer Adresse oder einem Browser aus sperren, zeitlich begrenzt oder dauerhaft',
        '- Einträge aus der Tagesrangliste oder der Statistik entfernen und Ergebnisse nicht werten',
        'Wir müssen dir dafür keine Begründung geben, werden aber bei einer dauerhaften Sperre die Gründe, soweit möglich, mitteilen. Wenn du meinst, zu Unrecht gesperrt zu sein, schreib uns an die unten genannte Adresse.',
        'Das Spiel hat derzeit keine eingebaute Meldefunktion und kein Konto. Gesperrt wird deshalb über die Adresse oder den Browser, mit dem du spielst. Wir können das nicht zuverlässig verhindern, und wir prüfen nicht jede Partie.',
      ],
    },
    {
      title: 'Was du bei Verstößen tun kannst',
      body: [
        'Wenn dich ein anderer Spieler stört, kannst du den Raum verlassen oder den Chat ausschalten. Verstöße melde an die Adresse unten, mit dem Raum, dem Zeitpunkt und dem Spielnamen des Beteiligten. Wir antworten, sobald wir können, aber nicht garantiert innerhalb eines bestimmten Zeitraums.',
      ],
    },
    {
      title: 'Verfügbarkeit',
      body: [
        'Slingshot ist kostenlos und wird ohne Gewähr bereitgestellt. Der Relay-Server kann gewartet, verändert oder abgeschaltet werden; Online-Räume, Ranglisten und Statistiken können dabei verloren gehen. Wir garantieren keine ständige Erreichbarkeit.',
      ],
    },
    {
      title: 'Änderungen und Kontakt',
      body: [
        'Wir können diese Bedingungen ändern, wenn sich die Online-Funktionen ändern. Die jeweils aktuelle Fassung steht auf dieser Seite; wesentliche Änderungen zeigen wir in den Online-Funktionen an, bevor du weiterspielst.',
        'Fragen, Meldungen und Widersprüche an: [slingshotremake@gmail.com](mailto:slingshotremake@gmail.com).',
      ],
    },
  ],
};

const en: TermsText = {
  updated: 'Last updated: 20 November 2026',
  sections: [
    {
      title: 'Scope',
      body: [
        'These terms of use apply to the online features of Slingshot: online rooms, chat, player names, the daily leaderboard and the statistics. Playing offline – against CPUs or on one device – is not affected and has no terms beyond the licence of the source code (GPL-3.0).',
        'By joining an online room, posting a result or opening the statistics you accept these terms. If you do not accept them, switch the online features off under Settings → Online features.',
      ],
    },
    {
      title: 'Play fair',
      body: [
        'You may not cheat in online play, on the daily leaderboard or in the statistics. In particular, you must not:',
        '- change the game so that moves, hits, points or results are faked, even if you only change your own client',
        '- use scripts, bots or automation that make moves for you online or on the daily leaderboard,',
        '- post a leaderboard entry for a run you did not play, or a score you did not reach,',
        '- flood the relay, get around its limits (for example by changing browser ids or addresses), or fill the statistics with phantom rounds,',
        '- agree with other players to manipulate results or bets.',
        'A game that breaks off because of a bug or a connection problem is not a violation. The rules apply equally to everyone in the room.',
      ],
    },
    {
      title: 'Treat each other with respect',
      body: [
        'Be fair and respectful. The following are not allowed in chat, in player names, room names or on the daily leaderboard:',
        '- insults, bullying, threats and harassment of other players',
        '- hate speech, that is content that demeans people for their origin, religion, gender, sexual orientation, disability or similar traits',
        '- vulgar, pornographic or sexually suggestive content, and content glorifying violence',
        '- names, symbols or texts meant to deceive others (for example by using another person\'s name or pretending to be a moderator)',
        '- other people\'s personal data, advertising, spam, links to malware, or requests to contact someone outside the game or send money',
        'The relay\'s filter replaces swear words in chat messages with asterisks and refuses names with clearly offensive words. It helps, but it is not complete: workarounds and innuendo are not allowed either, and you are responsible for what you write.',
        'Chat messages are not private. Everybody in the room sees them, and chat is limited to a few messages in a short time.',
      ],
    },
    {
      title: 'What we may do',
      body: [
        'If somebody breaks these terms, we may act at our discretion, in particular by:',
        '- removing or replacing messages or names',
        '- closing an online room or removing players from it',
        '- blocking connections to the relay from an address or browser, for a time or permanently',
        '- removing entries from the daily leaderboard or the statistics and not counting results',
        'We do not have to give you a reason, but for a permanent block we will tell you the reasons where possible. If you think a block is unjustified, write to the address below.',
        'The game currently has no built-in report function and no account. Blocks therefore apply to the address or browser you play from. We cannot prevent this reliably, and we do not review every match.',
      ],
    },
    {
      title: 'If you see a violation',
      body: [
        'If another player bothers you, you can leave the room or turn the chat off. Report violations to the address below, with the room, the time and the player\'s name. We reply as soon as we can, but cannot promise a set time.',
      ],
    },
    {
      title: 'Availability',
      body: [
        'Slingshot is free of charge and provided without warranty. The relay server may be maintained, changed or switched off; online rooms, leaderboards and statistics may be lost in the process. We do not guarantee that it is always reachable.',
      ],
    },
    {
      title: 'Changes and contact',
      body: [
        'We may change these terms when the online features change. The current version is on this page; we will show significant changes in the online features before you continue playing.',
        'Questions, reports and objections to: [slingshotremake@gmail.com](mailto:slingshotremake@gmail.com).',
      ],
    },
  ],
};

export const TERMS_TEXT: Record<Lang, TermsText> = { de, en };
