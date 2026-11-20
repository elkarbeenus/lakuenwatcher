# LakuenWatcher

Watch your series in peace while the addon opens the next episode of your show.

Browser-Erweiterung für **Brave** (und andere Chromium-Browser wie Chrome und Edge): Wenn eine Folge zu Ende ist, öffnet LakuenWatcher automatisch die nächste Folge im selben Tab und startet sie. Du musst nicht mehr pausieren, den Tab schließen und die nächste Folge suchen.

## Funktionen

- **Erkennt das Ende einer Folge**, auch wenn der Player in einem eingebetteten Fremd-Player (iframe) läuft
- **Öffnet die nächste Folge**, am Staffelende die erste Folge der nächsten Staffel
- **Startet die nächste Folge direkt mit Ton**: Innerhalb einer Staffel wird nur der Player getauscht, die Seite lädt nicht neu. Blockt der Browser trotzdem, startet die Folge stumm mit einem Knopf „🔊 Ton an“.
- **Weiterschauen**: Im Popup stehen die zuletzt geschauten Serien. Ein Klick, und es geht an der letzten Stelle weiter.
- **Intro/Abspann pro Serie**: Jede Serie bekommt eigene Werte, die allgemeinen gelten als Vorgabe.
- **Lieblings-Hoster und Sprache**: z. B. Deutsch vor Englisch und VOE vor Doodstream. Lädt ein Hoster nicht, wird automatisch der nächste probiert.
- **Sleep-Timer**: Nach 30 Minuten bis 2 Stunden ist nach der laufenden Folge Schluss.
- **Tasten**: Im Player **N** für die nächste Folge und **S** fürs Intro überspringen. Überall im Browser gehen **Alt+Shift+N** und **Alt+Shift+S**.
- **Countdown mit „Abbrechen“** vor dem Wechsel (Standard 5 s)
- **Stopp nach X Folgen**, z. B. zum Einschlafen
- **Abspann überspringen**: X Sekunden vor Ende schon wechseln
- **Intro überspringen**: beim Start X Sekunden vorspulen
- Knopf **„Nächste Folge jetzt“** im Popup
- **An Fernseher senden**: zusammen mit [LakuenCast](https://github.com/elkarbeenus/LakuenCast) läuft die Folge auf dem Chromecast, inklusive Auto-Next
- **Update mit einem Klick** direkt in der Erweiterung

### Seiten-Profile

| Profil | Erkennung |
|---|---|
| SerienStream / AniWorld | `…/stream/<serie>/staffel-N/episode-M` |
| Filmpalast | `…/stream/<serie>-sXXeYY` |
| Allgemein | Folgennummer in der URL (`folge-5`, `episode-5`) oder ein Knopf „Nächste Folge“ / „Next“ |

Eine neue Seite kommt als weiteres Profil in [`extension/content/profiles.js`](extension/content/profiles.js) dazu.

## Installation

### SteamOS / Linux (mit Ein-Klick-Updates)

1. Konsole öffnen und einfügen:

   ```bash
   curl -fsSL https://github.com/elkarbeenus/lakuenwatcher/releases/latest/download/install.sh | bash
   ```

2. Wenn Brave als Flatpak installiert ist, Brave einmal komplett schließen und neu starten.
3. In Brave `brave://extensions` öffnen.
4. Oben rechts den **Entwicklermodus** einschalten.
5. **„Entpackte Erweiterung laden“** klicken und den Ordner `~/LakuenWatcher/extension` auswählen.
6. Über das Puzzle-Symbol LakuenWatcher **anpinnen**.

### Ohne Installer (Windows oder zum Ausprobieren)

Unter [Releases](https://github.com/elkarbeenus/lakuenwatcher/releases/latest) `LakuenWatcher-vX.Y.Z.zip` herunterladen, in einen Ordner entpacken und diesen wie oben unter Schritt 3 bis 5 laden. Updates gehen dann von Hand: neue ZIP in denselben Ordner entpacken und auf `brave://extensions` neu laden.

### Autoplay mit Ton

Brave blockiert oft Videos, die mit Ton von selbst starten. Für die Streaming-Seite einmal erlauben: Schloss-Symbol in der Adressleiste → **Website-Einstellungen** → **Autoplay: Zulassen**.

## Auf dem Fernseher schauen (Chromecast)

1. [LakuenCast](https://github.com/elkarbeenus/LakuenCast) starten und dort den Fernseher auswählen.
2. Die Folge im Browser kurz anspielen, damit LakuenWatcher die Videoadresse kennt.
3. Im Popup **„📺 An Fernseher senden“** klicken.

Die Folge läuft dann direkt auf dem Chromecast, im Browser bleibt sie stumm und pausiert. Ist sie zu Ende, öffnet LakuenWatcher die nächste Folge, spielt sie stumm kurz an und schickt sie automatisch an den Fernseher. „Stopp nach X Folgen“ gilt dabei auch.

## Updates

Die Erweiterung schaut beim Start und alle 6 Stunden bei GitHub nach einer neuen Version. Gibt es eine, zeigt das Symbol **NEU** und das Popup einen **Update**-Knopf. So läuft ein Update ab:

1. Der Klick legt die Datei `~/Downloads/LakuenWatcher-Update/request.json` an.
2. Der vom Installer eingerichtete systemd-Dienst `lakuenwatcher-update.path` bemerkt sie.
3. Er lädt das Release, prüft die SHA-256-Prüfsumme und ersetzt den Inhalt von `~/LakuenWatcher/extension`.
4. Die Erweiterung lädt sich selbst neu. Einstellungen bleiben erhalten.

Von Hand geht es mit `~/LakuenWatcher/bin/update.sh`.

## Entwicklung

```
extension/
  manifest.json        Manifest V3
  background.js        Ablauf: Ende gemeldet → nächste Folge → Autoplay, Updates
  content/frame.js     in jedem Frame: Video-Ende, Autoplay, Intro/Abspann
  content/profiles.js  Seiten-Profile (nächste Folge finden)
  content/page.js      Hauptframe: Countdown, Wechsel
  popup/               Popup-Oberfläche
  lib/                 Einstellungen, Versionsvergleich
scripts/install.sh     Installer (SteamOS/Linux)
scripts/update.sh      Updater
tests/run.mjs          node tests/run.mjs
```

**Release:** In `extension/manifest.json` den Wert `version_name` erhöhen und auf `main` pushen. Den Rest (Tests, ZIP, SHA-256, Tag, Release) macht GitHub Actions.

- `"0.2.0"` ergibt das Release v0.2.0
- `"0.2.0-test.1"` ergibt den Testbuild v0.2.0-test.1. Der ist im Titel markiert und für den Updater sichtbar.

## Hinweis

LakuenWatcher ist ein allgemeines Werkzeug für Seiten mit Episodenlisten und enthält keine Inhalte. Für die Rechtmäßigkeit der genutzten Streaming-Angebote bist du selbst verantwortlich.
