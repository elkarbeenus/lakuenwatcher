#!/usr/bin/env bash
# LakuenWatcher – Installer für SteamOS / Linux (einmalig ausführen)
#
#   curl -fsSL https://github.com/elkarbeenus/lakuenwatcher/releases/latest/download/install.sh | bash
#
# Was passiert:
#  1. Die Erweiterung landet in ~/LakuenWatcher/extension
#  2. Ein kleiner systemd-User-Dienst wird eingerichtet: Klick auf "Update" in
#     der Erweiterung → neue Version wird geladen und installiert.
#  3. Bei Brave als Flatpak bekommt Brave Lesezugriff auf den Ordner.
# Danach in Brave einmal "Entpackte Erweiterung laden" (siehe Ausgabe).
set -euo pipefail

REPO="elkarbeenus/lakuenwatcher"
BASE="${LAKUENWATCHER_HOME:-$HOME/LakuenWatcher}"
DL_DIR="$(xdg-user-dir DOWNLOAD 2>/dev/null || true)"
[ -n "$DL_DIR" ] && [ "$DL_DIR" != "$HOME" ] || DL_DIR="$HOME/Downloads"
UNIT_DIR="$HOME/.config/systemd/user"

log() { echo -e "\033[1;35m[LakuenWatcher]\033[0m $*"; }

for cmd in curl python3 sha256sum; do
  command -v "$cmd" >/dev/null || { log "$cmd fehlt."; exit 1; }
done

mkdir -p "$BASE/bin" "$DL_DIR/LakuenWatcher-Update"

log "Lade Updater …"
curl -fsSL "https://github.com/$REPO/releases/latest/download/update.sh" -o "$BASE/bin/update.sh"
chmod +x "$BASE/bin/update.sh"

log "Installiere Erweiterung …"
LAKUENWATCHER_HOME="$BASE" "$BASE/bin/update.sh" --force

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  log "Richte Update-Dienst ein …"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/lakuenwatcher-update.path" <<EOF
[Unit]
Description=LakuenWatcher: Update auf Klick in der Erweiterung

[Path]
PathExists=$DL_DIR/LakuenWatcher-Update/request.json

[Install]
WantedBy=default.target
EOF
  cat > "$UNIT_DIR/lakuenwatcher-update.service" <<EOF
[Unit]
Description=LakuenWatcher: Update installieren

[Service]
Type=oneshot
Environment=LAKUENWATCHER_HOME=$BASE
ExecStart=$BASE/bin/update.sh --from-request
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now lakuenwatcher-update.path >/dev/null
else
  log "systemd (User) nicht verfügbar – Updates dann mit: $BASE/bin/update.sh"
fi

if command -v flatpak >/dev/null && flatpak info com.brave.Browser >/dev/null 2>&1; then
  log "Brave-Flatpak gefunden – gebe Brave Lesezugriff auf $BASE …"
  flatpak override --user --filesystem="$BASE:ro" com.brave.Browser
  log "Falls Brave gerade offen ist: einmal komplett schließen und neu starten."
fi

cat <<EOF

$(log "Fertig!")

  Jetzt einmalig in Brave:
    1. brave://extensions öffnen
    2. Oben rechts "Entwicklermodus" einschalten
    3. "Entpackte Erweiterung laden" → Ordner auswählen:
         $BASE/extension
    4. Puzzle-Symbol → LakuenWatcher anpinnen

  Tipp: Damit die nächste Folge mit Ton von selbst startet, bei der Seite
  (Schloss-Symbol → Website-Einstellungen) "Autoplay: Zulassen" setzen.

  Updates: Wenn eine neue Version da ist, zeigt die Erweiterung "Update" –
  ein Klick reicht.
EOF
