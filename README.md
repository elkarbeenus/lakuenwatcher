# LakuenWatcher

**English** · [Deutsch](#deutsch)

A browser extension for Brave and other Chromium-based browsers (Chrome, Edge) that plays the next episode automatically when the current one ends — no pausing, closing tabs or searching for the next episode.

## Features

- **Detects the end of an episode**, including players embedded from third-party hosts (iframes)
- **Opens the next episode** in the same tab; at the end of a season it continues with episode 1 of the next season
- **Starts the next episode with sound**: within a season only the player is swapped and the page is not reloaded, so the browser keeps your earlier interaction. If autoplay is still blocked, the episode starts muted with a “Sound on” button.
- **Continue watching**: the popup lists recently watched series with progress; one click resumes where you left off
- **Per-series settings** for skipping intros and end credits
- **Preferred host and language**, with automatic fallback to the next host if one does not load
- **Sleep timer** (30 minutes to 2 hours) and **stop after N episodes**
- **Countdown with cancel** before switching (default 5 seconds)
- **Keyboard shortcuts**: `N` (next episode) and `S` (skip intro) inside the player; `Alt+Shift+N` / `Alt+Shift+S` anywhere in the browser
- **Send to TV** together with [LakuenCast](https://github.com/elkarbeenus/LakuenCast): the episode plays on a Chromecast, continues at the current position and advances automatically
- **One-click updates** from within the extension (Linux installer)

### Supported URL schemes

| Profile | Recognised pattern |
|---|---|
| Season/episode paths | `…/stream/<series>/staffel-N/episode-M` |
| Combined code | `…/stream/<series>-sXXeYY` |
| Generic | Episode number in the URL (`episode-5`, `folge-5`) or a “Next episode” button |

Additional sites can be added as profiles in [`extension/content/profiles.js`](extension/content/profiles.js).

## Installation

### SteamOS / Linux (with one-click updates)

1. Open a terminal and run:

   ```bash
   curl -fsSL https://github.com/elkarbeenus/lakuenwatcher/releases/latest/download/install.sh | bash
   ```

2. If Brave is installed as a Flatpak, close Brave completely and start it again.
3. Open `brave://extensions` and enable **Developer mode** (top right).
4. Click **Load unpacked** and select `~/LakuenWatcher/extension`.
5. Pin LakuenWatcher via the puzzle icon.

### Without the installer (Windows or for testing)

Download `LakuenWatcher-vX.Y.Z.zip` from [Releases](https://github.com/elkarbeenus/lakuenwatcher/releases/latest), extract it to a folder and load that folder as described in steps 3–4. To update, extract the new archive into the same folder and click reload on `brave://extensions`.

### Autoplay with sound

Browsers often block videos that start with sound on their own. Allow it once per site: lock icon in the address bar → **Site settings** → **Autoplay: Allow**.

## Watching on a TV (Chromecast)

1. Start [LakuenCast](https://github.com/elkarbeenus/LakuenCast) and select your TV.
2. Start the episode in the browser so LakuenWatcher can detect the video source.
3. Click **Send to TV** in the popup.

The episode continues on the TV at the current position while the browser stays muted and paused. When it ends, LakuenWatcher loads the next episode and sends it to the TV. **Stop sending** resumes playback in the browser at the position reached on the TV.

## Updates

The extension checks GitHub for a new release at start-up and every six hours. When one is available, the icon shows **NEU** and the popup offers an **Update** button:

1. The button creates `~/Downloads/LakuenWatcher-Update/request.json`.
2. The systemd user unit `lakuenwatcher-update.path` (set up by the installer) picks it up.
3. It downloads the release, verifies the SHA-256 checksum and replaces the contents of `~/LakuenWatcher/extension`.
4. The extension reloads itself; settings are kept.

Manual update: `~/LakuenWatcher/bin/update.sh`

## Development

```
extension/
  manifest.json        Manifest V3
  background.js        Flow control, continue watching, casting, updates
  content/frame.js     Runs in every frame: end detection, autoplay, intro/credits, shortcuts
  content/page.js      Top frame: countdown, in-place switch, host fallback
  content/profiles.js  Site profiles (finding the next episode)
  content/hosters.js   Preferred host and language
  popup/               Popup UI
  lib/                 Settings, series detection, version comparison
scripts/               Installer and updater (Linux)
tests/run.mjs          node tests/run.mjs
```

**Releases:** increase `version_name` in `extension/manifest.json` and push to `main`. GitHub Actions runs the tests, builds the archive with checksum and publishes the release. A version such as `0.5.0-test.1` produces a test build.

## Disclaimer

LakuenWatcher is a general-purpose tool for websites with episode lists and contains no media content. Users are responsible for complying with the terms and laws that apply to the services they use.

---

<a id="deutsch"></a>

# LakuenWatcher (Deutsch)

[English](#lakuenwatcher) · **Deutsch**

LakuenWatcher ist eine Browser-Erweiterung für Brave und andere Chromium-Browser wie Chrome und Edge. Ist eine Folge zu Ende, startet automatisch die nächste. Pausieren, Tabs schließen und die nächste Folge suchen entfällt.

## Funktionen

- **Erkennt das Ende einer Folge**, auch bei Playern, die von fremden Hostern eingebettet sind (iframe).
- **Öffnet die nächste Folge** im selben Tab. Am Staffelende geht es mit Folge 1 der nächsten Staffel weiter.
- **Startet die nächste Folge mit Ton**: Innerhalb einer Staffel wird nur der Player getauscht und die Seite nicht neu geladen. Dadurch bleibt die vorherige Bedienung gültig. Blockt der Browser trotzdem, startet die Folge stumm mit einem Knopf „Ton an“.
- **Weiterschauen**: Das Popup zeigt die zuletzt geschauten Serien mit Fortschritt. Ein Klick setzt an der letzten Stelle fort.
- **Einstellungen pro Serie** zum Überspringen von Intro und Abspann.
- **Bevorzugter Hoster und Sprache**. Lädt ein Hoster nicht, wird automatisch der nächste versucht.
- **Sleep-Timer** (30 Minuten bis 2 Stunden) und **Stopp nach X Folgen**.
- **Countdown mit Abbrechen** vor dem Wechsel (Standard 5 Sekunden).
- **Tastenkürzel**: `N` (nächste Folge) und `S` (Intro überspringen) im Player, `Alt+Shift+N` / `Alt+Shift+S` überall im Browser.
- **An den Fernseher senden** zusammen mit [LakuenCast](https://github.com/elkarbeenus/LakuenCast): Die Folge läuft auf einem Chromecast an der aktuellen Stelle weiter, danach folgt automatisch die nächste.
- **Update mit einem Klick** direkt in der Erweiterung (Linux-Installer).

### Unterstützte URL-Schemata

| Profil | Erkanntes Muster |
|---|---|
| Staffel-/Folgenpfad | `…/stream/<serie>/staffel-N/episode-M` |
| Kombinierter Code | `…/stream/<serie>-sXXeYY` |
| Allgemein | Folgennummer in der URL (`episode-5`, `folge-5`) oder ein Knopf „Nächste Folge“ |

Weitere Seiten lassen sich als Profil in [`extension/content/profiles.js`](extension/content/profiles.js) ergänzen.

## Installation

### SteamOS / Linux (mit Ein-Klick-Updates)

1. Ein Terminal öffnen und ausführen:

   ```bash
   curl -fsSL https://github.com/elkarbeenus/lakuenwatcher/releases/latest/download/install.sh | bash
   ```

2. Ist Brave als Flatpak installiert: Brave vollständig schließen und neu starten.
3. `brave://extensions` öffnen und oben rechts den **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** wählen und `~/LakuenWatcher/extension` auswählen.
5. LakuenWatcher über das Puzzle-Symbol anheften.

### Ohne Installer (Windows oder zum Testen)

`LakuenWatcher-vX.Y.Z.zip` unter [Releases](https://github.com/elkarbeenus/lakuenwatcher/releases/latest) herunterladen, in einen Ordner entpacken und diesen wie in Schritt 3–4 laden. Zum Aktualisieren das neue Archiv in denselben Ordner entpacken und auf `brave://extensions` neu laden.

### Autoplay mit Ton

Browser blockieren oft Videos, die von selbst mit Ton starten. Einmal pro Seite erlauben: Schloss-Symbol in der Adressleiste → **Website-Einstellungen** → **Autoplay: Zulassen**.

## Auf dem Fernseher schauen (Chromecast)

1. [LakuenCast](https://github.com/elkarbeenus/LakuenCast) starten und den Fernseher auswählen.
2. Die Folge im Browser starten, damit LakuenWatcher die Videoquelle erkennt.
3. Im Popup **An Fernseher senden** wählen.

Die Folge läuft auf dem Fernseher an der aktuellen Stelle weiter, im Browser bleibt sie stumm und pausiert. Ist sie zu Ende, lädt LakuenWatcher die nächste Folge und sendet sie an den Fernseher. **Senden beenden** setzt die Wiedergabe im Browser an der Stelle fort, die der Fernseher erreicht hat.

## Updates

Die Erweiterung prüft beim Start und alle sechs Stunden, ob es auf GitHub ein neues Release gibt. Gibt es eines, zeigt das Symbol **NEU** und das Popup einen Knopf **Update**:

1. Der Knopf legt die Datei `~/Downloads/LakuenWatcher-Update/request.json` an.
2. Der vom Installer eingerichtete systemd-Dienst `lakuenwatcher-update.path` bemerkt die Datei.
3. Er lädt das Release, prüft die SHA-256-Prüfsumme und ersetzt den Inhalt von `~/LakuenWatcher/extension`.
4. Die Erweiterung lädt sich neu, die Einstellungen bleiben erhalten.

Manuelles Update: `~/LakuenWatcher/bin/update.sh`

## Entwicklung

Aufbau des Projekts und Tests: siehe Abschnitt [Development](#development).

**Releases:** In `extension/manifest.json` den Wert `version_name` erhöhen und auf `main` pushen. GitHub Actions führt die Tests aus, baut das Archiv mit Prüfsumme und veröffentlicht das Release. Eine Version wie `0.5.0-test.1` ergibt einen Testbuild.

## Haftungsausschluss

LakuenWatcher ist ein allgemeines Werkzeug für Webseiten mit Episodenlisten und enthält keine Medieninhalte. Für die Einhaltung der Bedingungen und Gesetze, die für die genutzten Angebote gelten, sind die Nutzer selbst verantwortlich.
