# Menü: Richtung und Entscheidungen

> Für die nächste Umsetzung gilt die neuere [UX-Spezifikation und Agent-Übergabe](menu-ux-spec.md). Dieser Text dokumentiert die erste Gestaltungsrichtung; die ursprünglichen Folgeschritte sind keine vollständige Beschreibung des aktuellen Entwurfs.

Das Menü soll sich wie der Einstieg in ein Gravitationsduell anfühlen. Die Bahn eines Schusses ist das wiederkehrende Motiv. Die Referenzen liefern dafür eine passende Bildsprache; ihre vielen Rahmen, Leuchteffekte und konkurrierenden Überschriften werden sparsamer eingesetzt.

## Visuelle Grundlage

| Rolle | Entscheidung |
| --- | --- |
| Hintergrund | Marineblau `#0b1a33`, tiefe Flächen `#071122` |
| Text | Warmes Weiß `#e8e4d8`, Begleittext `#9aa6bd` |
| Aktion und Auswahl | Orange `#ffad65` |
| Werte und Links | Mint `#6fe3c8` |
| Schrift | Big Shoulders Stencil für Marke und kurze Überschriften; B612 für lesbare Erklärungen; B612 Mono für Werte |
| Eigenständiges Motiv | Gezeichnete Orbit-Szenen: ein gebogener Schuss, ein schwarzes Loch, chaotische Bahnen |

Die Modusbilder sind skalierbare SVGs. Sie passen zu den Farben des Spiels, bleiben auf allen Displaygrößen scharf und brauchen keine externen Bilddienste. Eine helle Kontur zeigt den Tastaturfokus; Orange plus Häkchen zeigt die Auswahl. Beides darf gleichzeitig sichtbar sein.

## Aufbau

```text
SLINGSHOT                                  Kurzbeschreibung

Lokal / Solo       Klassisch      Ereignishorizont      Mayhem
Online spielen     └── Moduswahl mit eigener Illustration ──┘
Anleitung          Tägliche Herausforderung · heutige Mission
Einstellungen      Auswahl                         Match vorbereiten →

Tastaturhilfe                          Sprache             Version
```

Die lokale Moduswahl steht direkt im Hauptmenü. Die tägliche Herausforderung hat einen eigenen Einstieg: Sie ist eine feste Solo-Mission und braucht keine gewöhnliche Match-Vorbereitung. Mayhem bleibt von Party getrennt: Mayhem verändert Regeln zwischen den Runden, Party ist eine feste Regelvorlage.

Klassisch und Ereignishorizont öffnen eine kompakte Vorbereitung:

```text
Modus und Erklärung

Standard · Trickshot · Sniper · Party       Crew und Mitspieler ändern
Runden · Planeten · Power-ups              Regelüberblick / Regeln anpassen

← Zurück                                              Spiel starten →
```

Eigene Regeln bleiben beim Öffnen erhalten. Eine Vorlage ersetzt die Regeln ausdrücklich, behält aber Crew, Teams und Geräteeinstellungen. Die aktive Vorlage wird aus den tatsächlichen Werten ermittelt. Weichen sie ab, steht dort „Eigene Regeln“. Alle bisherigen Regler bleiben über „Regeln anpassen“ erreichbar.

Auf schmalen Handys werden aus den drei Moduskarten kompakte Zeilen. Die Hauptaktion bleibt beim Scrollen sichtbar. Die vier Vorlagen stehen in zwei Spalten; Crew und Detailregeln folgen darunter. So bleiben alle Möglichkeiten erreichbar, ohne kleine Desktop-Elemente einfach zusammenzustauchen.

## Nächste sinnvolle Ausbaustufen

- **Crew direkt bearbeiten:** Mensch/CPU und Hinzufügen in der Vorbereitung anbieten, sobald sechs Plätze und Teamwahl dort übersichtlich unterzubringen sind. Die derzeitige eigene Crew-Seite hält die Vorbereitung ruhig.
- **Letztes Match wiederholen:** Ein direkter Einstieg mit Modus, Regeln und Crew des letzten Matches. Dafür den letzten tatsächlich gespielten Zustand speichern, unabhängig von gerade bearbeiteten Einstellungen.
- **Multiplayer im Hauptmenü:** Die drei Karten „Raum suchen“, „Raum erstellen“ und „Code eingeben“ gehören in den rechten Bereich des Hauptmenüs, sobald Online ausgewählt ist. Der separate Online-Einstieg des zweiten Entwurfs muss dafür integriert werden.
- **Regeln erklären:** Bei komplexen Optionen wie Schonfrist und fester Schusskraft eine knappe Erklärung direkt am Regler anbieten. Ein konkretes Beispiel hilft mehr als zusätzliche Symbole.

Der erste Entwurf ist als `70d4c94` gesichert. Ein zweiter Entwurf enthält weitere Menüseiten und vereinfachte Abläufe, ist aber noch nicht visuell abgenommen. Die verbindlichen Ziele, offenen Punkte und Abnahmekriterien stehen in der neueren UX-Spezifikation.
