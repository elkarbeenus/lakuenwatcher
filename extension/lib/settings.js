// Gemeinsame Einstellungen (chrome.storage.local). content/*.js liest dieselben
// Schlüssel direkt, weil Content-Scripts keine Module laden können.

export const DEFAULTS = {
  enabled: true,      // Automatisch zur nächsten Folge
  stopAfter: 0,       // Nach X automatisch gestarteten Folgen anhalten (0 = nie)
  countdown: 5,       // Sekunden Countdown vor dem Wechsel (0 = sofort)
  outroSkip: 0,       // So viele Sekunden vor Ende schon wechseln (Abspann)
  introSkip: 0,       // Beim Start einer Folge so viele Sekunden überspringen
  autoplay: true,     // Neue Folge automatisch starten
  updateCheck: true,  // Beim Start nach neuer Version auf GitHub schauen
  resume: true,       // An der letzten Stelle weiterschauen
  autoHoster: true,   // Lieblings-Hoster und Sprache automatisch wählen
  language: "de",     // de | en-sub | en | any
  hosterOrder: "VOE, Doodstream, Vidoza, Filemoon, Streamtape, Vidmoly",
  keys: true,         // Tasten N (nächste Folge) und S (Intro überspringen) im Player
};

export const REPO = "elkarbeenus/lakuenwatcher";

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
