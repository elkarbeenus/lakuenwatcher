#!/usr/bin/env bash
# LakuenWatcher – Updater
# Lädt das neueste Release von GitHub, prüft SHA-256 und ersetzt den Inhalt
# von ~/LakuenWatcher/extension. Der Ordner selbst bleibt derselbe, damit Brave
# die Erweiterung (und ihre Einstellungen) behält.
#
#   update.sh               nur aktualisieren, wenn es eine neuere Version gibt
#   update.sh --force       immer neu installieren
#   update.sh --from-request  vom systemd-Dienst aufgerufen (Klick auf "Update")
#
# LAKUENWATCHER_HOME   anderer Installationsordner (Standard: ~/LakuenWatcher)
# LAKUENWATCHER_TAG    bestimmtes Release statt "latest" (z. B. v0.2.0-test.1)
set -euo pipefail

REPO="elkarbeenus/lakuenwatcher"
BASE="${LAKUENWATCHER_HOME:-$HOME/LakuenWatcher}"
EXT="$BASE/extension"
DL_DIR="$(xdg-user-dir DOWNLOAD 2>/dev/null || true)"
[ -n "$DL_DIR" ] && [ "$DL_DIR" != "$HOME" ] || DL_DIR="$HOME/Downloads"
REQUEST="$DL_DIR/LakuenWatcher-Update/request.json"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --from-request) FORCE=0 ;;
  esac
done

log() { echo "[LakuenWatcher] $*"; }

# Anfrage-Datei sofort wegräumen, sonst startet systemd den Dienst immer wieder.
rm -f "$REQUEST"

mkdir -p "$BASE"
exec 9>"$BASE/.update.lock"
flock -n 9 || { log "Update läuft schon."; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${LAKUENWATCHER_TAG:-}" ]; then
  API="https://api.github.com/repos/$REPO/releases/tags/$LAKUENWATCHER_TAG"
else
  API="https://api.github.com/repos/$REPO/releases/latest"
fi

log "Frage GitHub nach der neuesten Version …"
curl -fsSL -H "Accept: application/vnd.github+json" "$API" -o "$TMP/release.json"

read -r TAG ZIP_URL SHA_URL UPD_URL < <(python3 - "$TMP/release.json" <<'PY'
import json, sys
rel = json.load(open(sys.argv[1]))
assets = {a["name"]: a["browser_download_url"] for a in rel.get("assets", [])}
zip_url = next((u for n, u in assets.items() if n.endswith(".zip")), "")
sha_url = next((u for n, u in assets.items() if n.endswith(".zip.sha256")), "")
upd_url = assets.get("update.sh", "-")
print(rel["tag_name"], zip_url or "-", sha_url or "-", upd_url)
PY
)

if [ "$ZIP_URL" = "-" ] || [ "$SHA_URL" = "-" ]; then
  log "Release $TAG hat keine ZIP/SHA256-Datei – Abbruch."; exit 1
fi

INSTALLED=""
if [ -f "$EXT/manifest.json" ]; then
  INSTALLED="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version_name",""))' "$EXT/manifest.json")"
fi
WANT="${TAG#v}"
if [ "$FORCE" = 0 ] && [ "$INSTALLED" = "$WANT" ]; then
  log "Schon aktuell ($INSTALLED)."; exit 0
fi

log "Lade $TAG …"
ZIP_NAME="$(basename "$ZIP_URL")"
curl -fsSL "$ZIP_URL" -o "$TMP/$ZIP_NAME"
curl -fsSL "$SHA_URL" -o "$TMP/$ZIP_NAME.sha256"
( cd "$TMP" && sha256sum -c "$ZIP_NAME.sha256" >/dev/null ) || { log "SHA-256 stimmt nicht – Abbruch, nichts geändert."; exit 1; }
log "SHA-256 ok."

mkdir -p "$TMP/new"
python3 -m zipfile -e "$TMP/$ZIP_NAME" "$TMP/new"
[ -f "$TMP/new/manifest.json" ] || { log "ZIP enthält keine manifest.json – Abbruch."; exit 1; }

# Inhalt ersetzen, Ordner behalten.
mkdir -p "$EXT"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude updater.json "$TMP/new/" "$EXT/"
else
  find "$EXT" -mindepth 1 -maxdepth 1 ! -name updater.json -exec rm -rf {} +
  cp -a "$TMP/new/." "$EXT/"
fi
printf '{"updater": true, "installedAt": "%s"}\n' "$(date -Iseconds)" > "$EXT/updater.json"

# Updater selbst mit aktualisieren
if [ "$UPD_URL" != "-" ]; then
  mkdir -p "$BASE/bin"
  if curl -fsSL "$UPD_URL" -o "$TMP/update.sh"; then
    install -m 755 "$TMP/update.sh" "$BASE/bin/update.sh"
  fi
fi

log "Installiert: $TAG (vorher: ${INSTALLED:-nichts}). Die Erweiterung lädt sich gleich selbst neu."
