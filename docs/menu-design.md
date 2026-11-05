# Menü: Richtung und Abläufe

Die verbindlichen Interaktions- und Abnahmeziele stehen in der [UX-Spezifikation und Agent-Übergabe](menu-ux-spec.md). Diese Seite hält die aktuelle Menüstruktur und ihre visuelle Richtung fest.

## Visuelle Grundlage

| Rolle | Entscheidung |
| --- | --- |
| Hintergrund | Marineblau `#0b1a33`, tiefe Flächen `#071122` |
| Text | Warmes Weiß `#e8e4d8`, Begleittext `#9aa6bd` |
| Aktion und Auswahl | Orange `#ffad65` |
| Werte und Links | Mint `#6fe3c8` |
| Schrift | Big Shoulders Stencil für Marke und kurze Überschriften; B612 für lesbare Erklärungen; B612 Mono für Werte |
| Eigenständiges Motiv | Gezeichnete Orbit-Szenen und die Schiffe des Spiels als SVG |

Eine helle Kontur zeigt Tastaturfokus; eine Auswahl erhält zusätzlich zum Orange ein Häkchen. Hover aktiviert oder wählt keine Karte. Bewegungen bleiben dezent und entfallen bei `prefers-reduced-motion`.

## Hauptmenü

```text
SLINGSHOT

Lokal / Solo       Klassisch      Ereignishorizont      Solar System
Online spielen     Tägliche Herausforderung · heutige Mission
Anleitung
Einstellungen      ODER, bei Online:
                   Raum suchen       Raum erstellen       Code eingeben

Tastaturhilfe                          Sprache             Version
```

Der Rahmen des Hauptmenüs – Seitenabstand, Navigation und Fußzeile – bleibt beim Wechsel zwischen Lokal und Online an derselben Stelle. Der Inhaltsbereich reserviert die Höhe des jeweils größeren Bereichs, damit die Fußzeile auch auf kurzen Viewports nicht nach oben springt. Nur der rechte Inhalt wechselt. Lokale Moduskarten öffnen direkt die passende Vorbereitung; die tägliche Herausforderung öffnet ihre Missionsbeschreibung. Es gibt keine zusätzliche Zeile mit Moduszusammenfassung und „Match vorbereiten“.

Hauptmenü und Untermenüs – Flugtraining, Einstellungen, Matchvorbereitung, Crew, Regeln, Daily, Online und Ergebnisse – folgen dem normalen Browserzoom ohne zusätzliche Zoom-Kompensation. Auf Desktop teilen sie dieselbe obere Position, die fließende Rahmenhöhe und eine einheitliche Footer-Zeile. Dadurch bleibt auch die Trennlinie beim Wechsel zwischen Hauptmenü und Unterseiten auf derselben Höhe. Der Rahmen ist 1280 px breit und höchstens 764 px hoch; kleine Viewports verkleinern ihn. Lange Inhalte scrollen darin, während die Aktionen erreichbar bleiben. Zusätzliche Fensterhöhe löst keinen Wechsel zu einem zentrierten 900 px hohen Rahmen oder einer anderen Kartengröße aus.

Eingangsanimationen bewegen nur Überschrift und Hauptinhalt. Die Q/E-Hinweise liegen in einer eigenen, ruhenden Kopfzeile. Sie, die Spieler-/Regelspalte der lokalen Vorbereitung, der Footer und die Trennlinie bleiben auch bei aktivierten Menübewegungen an ihrer Position.

Die Online-Karten führen direkt zur Raumsuche, Raumerstellung oder Code-Eingabe. Die Raumsuche zeigt eigene Lade-, Fehler- und Leerzustände. Die Raumerstellung beginnt mit Modus und Regelvorlage; Raumoptionen und vollständige Regeln bleiben hinter benannten Offenlegungen erreichbar. Code-Eingabe bleibt ein eigener kurzer Ablauf.

## Vorbereitungen und Crew

Klassisch, Ereignishorizont und Solar System öffnen eine Vorbereitung mit Regelvorlagen, einem kompakten Regelüberblick und einer Aktion zum Ändern vollständiger Regeln. Vorlagen ersetzen Matchregeln ausdrücklich und behalten Crew, Teams und Geräteeinstellungen. Eigene Regeln bleiben beim Öffnen erhalten; die aktive Vorlage wird aus den tatsächlichen Werten bestimmt.

Mayhem ist eine Vorlage in Klassisch und Ereignishorizont, kein eigener Modus: Solange sie aktiv ist, erscheint ein Stärkeregler. Lokale Vorbereitung und Online-Raum teilen sich dieselbe Kartenlogik (`src/ui/presets/preset-cards.ts`); beide Abläufe unterscheiden sich nur über den `PresetHost`, der Regeln und Speicherung liefert.

Die Crew-Seite zeigt Schiffe als kompakte Karten. Mensch oder CPU ist direkt wählbar; Schwierigkeitsgrad erscheint nur bei CPU. Teams, Hinzufügen und Entfernen bleiben sichtbar, ohne alle sechs Plätze mit bedingten Feldern gleichzeitig auszuschreiben.

## Daily

Die Missionsbeschreibung führt über fünf verbundene Sektoren. Die Auswahl zeigt Ziele, Schussbudget, Schwierigkeit und echte Modifikatoren in einem gemeinsamen Detailbereich. Bestwert, Versuche und Serie bleiben ergänzende Kennzahlen. Ein Start beginnt den vollständigen Lauf bei Sektor eins.

Das Ergebnis stellt Punktzahl und Rang vor die fünf echten Sektorverläufe. Kopieren und optionale Ranglisteneinträge bleiben ausdrückliche Aktionen; Ergebnisse werden nie automatisch veröffentlicht.

## Kleine Bildschirme

Der gemeinsame mobile Vertrag liegt in `src/ui/menu/menu-page/mobile.css`: dieselbe 36-px-Überschrift, 14-px-Feldbeschriftung, 16-px-Hauptaktion, 20-px-Seitenabstände, 24-px-Gruppenabstände und 44–52-px-Bedienflächen für alle Menüseiten. Die Stencil-Schrift kennzeichnet kurze Überschriften; B612 hält Formulare und Aktionen lesbar. Die Komponenten definieren ihre Anordnung, aber keine eigenen verkleinerten Typografien oder Touch-Zielgrößen. Alle Regeln dieses Vertrags gelten nur bis 760 px; die Desktop-Darstellung bleibt außerhalb davon unverändert.

Bei schmalen Viewports füllt der Seitenrahmen die verfügbare Höhe; die Aktionen bleiben am unteren Rand erreichbar. Einstellungen und vollständige Regeln zeigen jeweils eine Kategorie, mit sichtbarer Kategorienavigation. Auf Desktop bleiben alle Gruppen im Überblick. Ein Sprachwechsel behält die gewählte Einstellungskategorie.

Regelvorlagen bilden auf dem Handy eine horizontal wischbare Kartenreihe mit einer sichtbaren Kante der nächsten Karte. Sobald die Reihe nach dem Wischen oder Blättern einrastet, wird die sichtbare Vorlage aktiv. Die Karte zum Erstellen einer neuen Vorlage öffnet sich weiterhin nur durch Tippen. Auch die Modusüberschriften bleiben wischbar; Moduswechsel greifen nicht innerhalb der Vorlagen. Es gibt keinen zusätzlichen Dropdown-Moduswähler. DOM-Reihenfolge und Wischreihenfolge stimmen überein. Eigene Regeln gehören zur selben Reihe, auch im Online-Raum. Änderungsaktionen sind ohne Hover erreichbar.

Die Kategorienavigation läuft als eine horizontal scrollbare Zeile; die aktive Kategorie bleibt nach einem Sprachwechsel sichtbar. Größere Zeilenabstände und mindestens 44 px hohe Power-up-Schalter geben den Bedienelementen Platz. Die Crew verwendet auf Handys kurze Schiffskarten mit direkt wählbarem Mensch/CPU und allen vier CPU-Stärken. Pro Team bleibt nur der nächste freie Platz sichtbar. Die fünf Daily-Sektoren bleiben in einer Reihe erkennbar. Tastaturhinweise einschließlich Q/E entfallen auf Touch-Geräten. Die Zielsteuerung bietet neben dem voreingestellten Winkelrad mit Kraftregler wieder den Stick aus dem Stand vor `0f0da52`, inklusive Wahl der Bedienseite.

Die Matchvorbereitung hält die wesentlichen Entscheidungen im sichtbaren Bereich: eine kompakte illustrierte Vorlage, Runden und Flugzeit nebeneinander, alle Power-up-Schalter sowie zwei kurze Zusammenfassungen mit den sichtbaren Aktionen zum Ändern von Crew und vollständigen Regeln. Der ausführliche Regelvergleich bleibt auf Desktop neben der Vorbereitung stehen; auf dem Handy führt „Regeln anpassen“ zu allen Werten. Zurücksetzen/Bearbeiten und Speichern liegen auf Handys in festen 44-px-Plätzen der vorhandenen Karussell-Werkzeugleiste. Änderungen aktivieren die Aktionen, ohne eine weitere Zeile einzublenden oder den Seiteninhalt zu verschieben.

`npx tsx scripts/mobile-check.ts` prüft gegen den laufenden Dev-Server Retina-Auflösung, echte Touch-Swipes, Kategorien und Sprachwechsel, Vorlagen speichern/abbrechen sowie Crew-Bedienung bei 320 und 430 px. `npm run screens` prüft zusätzlich die Seitengeometrie; `--png` liefert die Screenshots zur visuellen Abnahme.

`npx tsx scripts/setup-check.ts` misst zusätzlich die unveränderten Positionen beim Ändern, Speichern und Zurücksetzen einer Vorlage sowie die Sichtbarkeit von Crew-, Regel- und Startaktionen bei 440×956, 390×844 und 320×740. Am großen Telefon prüft es auch die zusätzliche Mayhem-Stärke in allen drei Spielmodi.

## Wo der Code liegt

Die Ordner von `src/` und ihre Abhängigkeiten stehen in [architecture.md](architecture.md). Für die Menüs sind wichtig:

| Ort | Inhalt |
| --- | --- |
| `src/ui/screens/` | Seiten des Hauptmenüs; `index.ts` exportiert nur `App` und die vier Einstiegsseiten |
| `src/ui/lobby/` | Online-Lobby: `index.ts` ist der Rahmen, dazu `connection`, `browse`, `open-room`, `room`, `briefing`, `rules-form`, `widgets` |
| `src/ui/presets/preset-cards.ts` | Gemeinsame Regelvorlagen-Karten für lokal und online |
| `src/data/roomRules.ts` | Einzige Quelle für Regeltyp, Standardwerte, Kopieren und Prüfen |
| `src/sim/modes.ts` | `GameMode`, `GAME_MODES`, `CLASSIC_FAMILY` |

Seitenvergleich im Browser: `npm run screens` (siehe `scripts/screens.ts`).
