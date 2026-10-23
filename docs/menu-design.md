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

Lokal / Solo       Klassisch      Ereignishorizont      Mayhem
Online spielen     Tägliche Herausforderung · heutige Mission
Anleitung
Einstellungen      ODER, bei Online:
                   Raum suchen       Raum erstellen       Code eingeben

Tastaturhilfe                          Sprache             Version
```

Der Rahmen des Hauptmenüs – Seitenabstand, Navigation und Fußzeile – bleibt beim Wechsel zwischen Lokal und Online an derselben Stelle. Der Inhaltsbereich reserviert die Höhe des jeweils größeren Bereichs, damit die Fußzeile auch auf kurzen Viewports nicht nach oben springt. Nur der rechte Inhalt wechselt. Lokale Moduskarten öffnen direkt die passende Vorbereitung; die tägliche Herausforderung öffnet ihre Missionsbeschreibung. Es gibt keine zusätzliche Zeile mit Moduszusammenfassung und „Match vorbereiten“.

Die Online-Karten führen direkt zur Raumsuche, Raumerstellung oder Code-Eingabe. Die Raumsuche zeigt eigene Lade-, Fehler- und Leerzustände. Die Raumerstellung beginnt mit Modus und Regelvorlage; Raumoptionen und vollständige Regeln bleiben hinter benannten Offenlegungen erreichbar. Code-Eingabe bleibt ein eigener kurzer Ablauf.

## Vorbereitungen und Crew

Klassisch und Ereignishorizont öffnen eine Vorbereitung mit vier echten Regelvorlagen, einem kompakten Regelüberblick und einer Aktion zum Ändern vollständiger Regeln. Vorlagen ersetzen Matchregeln ausdrücklich und behalten Crew, Teams und Geräteeinstellungen. Eigene Regeln bleiben beim Öffnen erhalten; die aktive Vorlage wird aus den tatsächlichen Werten bestimmt.

Mayhem ist ein eigener Modus. Die Vorbereitung zeigt nur Mayhem-Regler und Besatzung; die Online-Raumerstellung hält Mayhem ebenfalls klar von der Party-Vorlage getrennt.

Die Crew-Seite zeigt Schiffe als kompakte Karten. Mensch oder CPU ist direkt wählbar; Schwierigkeitsgrad erscheint nur bei CPU. Teams, Hinzufügen und Entfernen bleiben sichtbar, ohne alle sechs Plätze mit bedingten Feldern gleichzeitig auszuschreiben.

## Daily

Die Missionsbeschreibung führt über fünf verbundene Sektoren. Die Auswahl zeigt Ziele, Schussbudget, Schwierigkeit und echte Modifikatoren in einem gemeinsamen Detailbereich. Bestwert, Versuche und Serie bleiben ergänzende Kennzahlen. Ein Start beginnt den vollständigen Lauf bei Sektor eins.

Das Ergebnis stellt Punktzahl und Rang vor die fünf echten Sektorverläufe. Kopieren und optionale Ranglisteneinträge bleiben ausdrückliche Aktionen; Ergebnisse werden nie automatisch veröffentlicht.

## Kleine Bildschirme

Bei schmalen Viewports wird die Navigation kompakt und die Online-Karten werden zu illustrierten Zeilen. Crew-Karten wechseln bei 320 px in eine Spalte; die fünf Daily-Sektoren bleiben in einer Reihe erkennbar. Seitenabstände, berührbare Ziele, fokussierte Eingaben und Sprache bleiben nutzbar.
