# Slingshot

Web-Remake des Linux-Klassikers [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): Zwei Raumschiffe schießen abwechselnd aufeinander, und jeder Schuss wird von der Schwerkraft der Planeten dazwischen abgelenkt. Anzahl, Größe und Lage der Planeten ändern sich jede Runde. Alte Schussbahnen bleiben stehen, damit man sich an den Treffer herantasten kann.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Physik-, Wertungs- und CPU-Tests
npm run build      # statischer Build in dist/ – läuft auf jedem Webserver
```

## Steuerung

| Taste | Aktion |
| --- | --- |
| ← → | Schiff drehen |
| ↑ ↓ | Schusskraft |
| Enter / Leertaste | Feuer |
| Shift | große Schritte (×10) |
| Alt | kleine Schritte (×0,1) |
| Strg oder Alt+Shift | sehr kleine Schritte (×0,01) – auf dem Mac belegt das System Strg+Pfeile |
| Ziehen (Maus/Touch) | direkt zielen, die Pfeilspitze folgt dem Zeiger |
| Leertaste | nächste Runde |
| Esc | Menü |
| F | Vollbild |

## Regeln & Wertung

- Ein Treffer bringt `1000 × Schussfaktor × Kraftfaktor` Punkte (gerundet auf 10).
  - Schussfaktor: 1,0 beim ersten Schuss der Runde, −0,15 pro weiterem Schuss, mindestens 0,25.
  - Kraftfaktor: `1,5 − Kraft/100`, also 0,5 bis 1,5. Bei fester Schusskraft immer 1.
- Wer das eigene Schiff trifft, schenkt dem Gegner 300 Punkte.
- Nach der letzten Runde gewinnt, wer mehr Punkte hat.

Einstellungen wie im Original: unsichtbare Planeten, reflektierende Ränder, feste Schusskraft, maximale Planetenzahl und Runden pro Spiel. Dazu kommen ein CPU-Gegner in drei Stärken, die maximale Flugzeit, Gravitationslinien, Partikel und Ton. Die Einstellungen werden im Browser gespeichert.

## Technik

Vite + TypeScript + Canvas 2D, ohne Engine und ohne Laufzeit-Abhängigkeiten außer drei selbst gehosteten Schriften.

| Datei | Aufgabe |
| --- | --- |
| `src/physics.ts` | Schuss-Integration (semi-implizites Euler, fester Zeitschritt 1/240 s), Kollisionen, Ränder |
| `src/world.ts` | Zufällige Spielfelder aus einem Seed |
| `src/game.ts` | Zustandsautomat: Zielen → Flug → Rundenende → Endstand |
| `src/ai.ts` | CPU: Zufallssuche + Hill-Climbing über dieselbe Physik, Streuung sinkt mit jedem Schuss |
| `src/scoring.ts` | Punkteformel |
| `src/render/` | Gestochene Planeten (Schraffur-Shader auf ImageData), Äquipotential-Höhenlinien (Marching Squares), Hintergrund, Partikel, HUD |
| `src/ui/` | DOM-Menüs mit Tastaturnavigation |
| `src/audio.ts` | Synthetisierte Soundeffekte über die Web Audio API |

Die Physik ist deterministisch, und der CPU-Planer nutzt exakt dieselbe `Shot`-Klasse wie das Spiel. Was die CPU vorausberechnet, fliegt also genau so.
