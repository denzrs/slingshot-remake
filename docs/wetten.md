# Wetten im Online-Modus

Stand: Branch `oracle-rework`. Das Schuss-Orakel („Trifft X?“) ist entfernt. Du wettest auf den Sieger der Runde. Quellen: `src/game/bets.ts` (Regeln), `src/game/match.ts` (Wettfenster, Abrechnung), `src/sim/config.ts` (`BETS`, `GALLERY`), `src/render/bets.ts` (Karte). Die englische Beschreibung für Spieler steht in [multiplayer.md](multiplayer.md#playing-online).

## Rettungskapseln und Fans (online, mit und ohne Wetten)

Wirst du online abgeschossen, sitzt du in einer **Rettungskapsel** in deiner Farbe.

- **Anfeuern:** Die Karte unten fragt „Wen feuerst du an?“. Du wählst mit Taste 1–5, über den Namen oder durch Antippen des Schiffs. Deine Kapsel fliegt hin und kreist mit den anderen Fans um das Schiff. Eine neue Wahl schickt sie zum nächsten Schiff.
- **Eigene Kapsel finden:** Deine Kapsel (als Zuschauer dein UFO) pingt auf deinem Bildschirm, kleiner als ein Schiff zu Rundenbeginn. Sie pingt beim Herauskommen, beim Flug zu einem anderen Schiff und alle 10 s.
- **Jubeln:** Taste **G**, der Knopf „Jubeln“ oder ein zweites Antippen deines Schiffs. Deine Kapsel hüpft mit einem Lichtring, und alle im Raum sehen es. Der Knopf blitzt auf und füllt sich 0,8 s lang grau, so lange wartest du bis zum nächsten Jubel. Jubeln macht keinen Ton.
  - **Epischer Jubel:** Mit jeder richtigen Ansage im Match wächst dein Jubel, bis Stufe fünf. Ab einer kommen mehr Funken dazu, die Hälfte in deiner Farbe. Ab zwei schießen Strahlen heraus, ab drei läuft ein dritter Ring mit. Ab vier dreht sich eine Krone um die Kapsel, bei fünf folgt eine zweite Funkenwelle. Deine Kapsel hüpft höher und länger.
  - **Forged** zeigt den Jubel als Feuerwerk aus Licht: Funkenstreifen fallen im Bogen, ab zwei liegt ein Lichtstreif quer durch die Kapsel. Ab drei folgt ein zweiter Lichtring in deiner Farbe mit sinkender Glut, ab vier kreisen sechs Lichter, bei fünf blitzen die Funken am Ende als Sterne auf.
  - Die Stufe gilt für deinen eigenen Jubel und für den Jubel beim Treffer deines Schiffs. Zuschauer machen keine Ansagen und jubeln auf Stufe null. Die Look-Galerie zeigt alle Stufen unter „Jubel-Stufen“.
- **Treffer:** Trifft dein Schiff, jubeln seine Fans gemeinsam („JUBEL ×n“).
- **Ansagen:** Zielt dein Schiff seinen nächsten Schuss (sein Zug oder eine Salve, bei Menschen wie bei CPUs), sagst du an: **Trifft** (T, es zerstört einen Gegner), **Daneben** (D, es zerstört nichts) oder **Getroffen** (X, es geht in diesem Flug selbst kaputt). Bis der Schuss fliegt, darfst du umentscheiden, und das Spiel hält das Zielen dafür mindestens 3 s offen, auch ohne Wetten. Deine Ansage steht als Schild über deiner Kapsel, nach dem Flug mit ✓ oder ✗.
  - **Mit Wette auf das Schiff:** Ein richtiges „Trifft“ hebt den Faktor um 1, ein richtiges „Daneben“ um 0,25. Eine falsche Ansage zieht 0,25 ab, der Faktor fällt aber nicht unter ×1,5. Ein richtiges „Getroffen“ versichert die Wette: Verlierst du sie, kostet sie den halben Einsatz.
  - **Ohne Wette:** Eine richtige Ansage bringt Matchpunkte: Trifft +50, Getroffen +30, Daneben +10 (ein Abschuss bringt 1.000). Eine falsche kostet nichts.
  - **Statistik:** Das Spiel meldet jede ausgewertete Ansage anonym als Schuss-Tipp an die Online-Statistik, als richtig oder falsch und ohne Einsatz. Die Kachel heißt „Nächsten Schuss richtig angesagt“.
- **Abschuss:** Geht dein Schiff unter und seine Seite ist raus, explodieren die Kapseln seiner Fans mit.
- **Zuschauer** feuern an und jubeln wie die Abgeschossenen, mit oder ohne Wetten. Dazu fliegen sie ein **UFO** in ihrer Farbe vom Feldrand herein, das außen um das Schiff kreist, gegen die Richtung der Kapseln. Jeder Look hat sein eigenes UFO, so unterscheidest du Zuschauer und Abgeschossene. Der Ring um ein Schiff fasst acht UFOs, jeder weitere Ring draußen vier mehr, und die Ringe drehen sich gegeneinander. Bei 20 Zuschauern reichen zwei Ringe für alle.
- **Offline** fliegen keine Kapseln. Quellen: `src/game/fans.ts` (`FanClub`, für die Tribüne `match.standsFans`), `Renderer.drawPods` und `drawUfos`, Eingaben `fan`, `cheer` und `call` (Protokoll 14).

## Schalter

Die Raumregel **„Wetten“** (`betting`) steht von Haus aus auf **an**. Schaltest du sie aus, bleiben Kapseln, Anfeuern und Ansagen, die Wetten fallen weg.

## Wer wettet

| Rolle | Wettet mit |
| --- | --- |
| **Ausgeschiedener** (abgeschossen, Mensch, am Tisch) | seinen **Matchpunkten** |
| **Zuschauer** | einem eigenen **Guthaben** von 500 je Match (mindestens 100 zu Rundenbeginn) |

## Die Rundenwette

- Du wettest **einmal pro Runde**, sobald jemand raus ist und mindestens zwei Seiten im Spiel sind. Das Fenster ist offen, solange die Schiffe zielen.
- **Seite wählen:** Taste 1–5 (0 = Remis, bei gleichzeitigem Schießen), über den Namen oder durch Antippen des Schiffs. Damit feuerst du das Schiff auch an, und deine Kapsel bleibt für die Runde dort.
- **Einsatz wählen:** **Q** = 25 %, **H** = 50 % (halb), **A** = alles, jeweils von deinen Punkten. Das Spiel rundet auf Zehner, mindestens 10.
- **Faktor:** Einsatz × **Anzahl der Seiten, die beim Setzen im Spiel sind**. Bei drei Übrigen gilt ×3, bei zwei ×2. Remis zahlt ×5.
  - Gewinn = Einsatz × (Faktor − 1)
  - Verlust = Einsatz
- Beim Setzen ziehst du keine Punkte ab.
- Fliegt deine Seite raus, verlierst du die Wette im selben Moment. Die Karte zeigt dann „WETTE VERLOREN −900 · Bob ist raus · Platz 2 → 3“.
- Die übrigen Wetten rechnet das Spiel am **Rundenende** ab.
- **Teams:** Eine Seite ist ein Team. Gewinnt das Team, gewinnst du, egal auf welches Mitglied du gesetzt hast.
- **Übersprungene Runde:** Das Spiel nimmt alle Wetten der Runde zurück. In einer **abgebrochenen Runde** verfallen offene Wetten, ohne etwas zu kosten.

**Beispiel:** Dora hat 1.800 Punkte und setzt nach dem ersten Abschuss alles auf Cem, bei drei Übrigen (×3).
- Gewinnt Cem, bekommt Dora **+3.600**.
- Fliegt Cem raus, verliert sie im selben Moment **1.800**.

## Was danach zu sehen ist

- **Rundenende:** Die Karte zeigt den Sieger, rechts groß deine Wette, darunter alle Wetten mit ihrem Ergebnis.
- **Pause:** deine Wett-Bilanz im Match und deine offene Wette.
- **Endbildschirm:** „Wetten im Match“ mit Bilanz und gewonnenen Wetten, dazu „Die besten Wetter der Tribüne“.

## Ausprobieren

`npm run dev`, dann `/?nointro&preview=bets-live`. Du bist in jeder Runde von Anfang an raus und hast 1.800 Punkte, vier Mitspieler schießen von selbst. `/?nointro&preview=fans-live` läuft ohne Wetten: Du feuerst an und jubelst, die abgeschossenen Mitspieler feuern mit, und neun Zuschauer fliegen ihre UFOs.

Online mit Relay: `npm run dev:local`, im DEV-Panel unter Online-Bots drei Bots in den Raum holen, ein zweiter Tab tritt per `?join=<Code>` als Zuschauer bei.

## Konstanten (`src/sim/config.ts`, `BETS`)

| Name | Wert |
| --- | --- |
| `STAKE_SHARES` | 25 % / 50 % / 100 % |
| `STAKE_STEP` / `STAKE_MIN` | 10 / 10 |
| `DRAW_MULTIPLIER` | 5 |
| `MIN_BET_TIME` | 3 s Zielzeit, bevor ein Schuss fliegt, solange jemand wetten oder ansagen kann |
| `RESULT_SECONDS` | 3 s zeigt die Karte ein Ergebnis |
| `GALLERY.BANKROLL` / `RELIEF` | 500 / 100 |
