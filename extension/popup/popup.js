import { DEFAULTS, getSettings, setSettings } from "../lib/settings.js";
import { displayVersion } from "../lib/version.js";

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabId = tab ? tab.id : null;

// ---------- Einstellungen ----------
const settings = await getSettings();
for (const key of Object.keys(DEFAULTS)) {
  const el = $(key);
  if (!el) continue;
  if (el.type === "checkbox") {
    el.checked = !!settings[key];
    el.addEventListener("change", () => setSettings({ [key]: el.checked }));
  } else {
    el.value = settings[key];
    el.addEventListener("change", () => {
      const n = Math.max(0, Math.min(+el.max || 999, parseInt(el.value, 10) || 0));
      el.value = n;
      setSettings({ [key]: n });
    });
  }
}

// ---------- Status ----------
async function refresh() {
  const st = await chrome.runtime.sendMessage({ type: "status", tabId });
  if (!st) return;
  $("version").textContent = displayVersion(st.version);

  const s = st.state;
  let text = `Folgen in diesem Tab: ${s.count}`;
  if (s.status === "stopped") text = `Gestoppt nach ${s.count} Folgen`;
  if (s.status === "end") text = "Keine weitere Folge gefunden";
  $("status").textContent = text;

  const banner = $("update");
  if (st.update) {
    banner.hidden = false;
    $("update-version").textContent = st.update.display;
    const waiting = st.updateRequestedAt && Date.now() - st.updateRequestedAt < 5 * 60_000;
    if (!st.updater) {
      $("update-text").textContent = "Einmal install.sh ausführen (siehe GitHub), dann geht das Update hier mit einem Klick.";
      $("update-btn").textContent = "Anleitung";
      $("update-btn").disabled = false;
    } else if (waiting) {
      $("update-text").textContent = "Wird installiert … die Erweiterung startet gleich neu.";
      $("update-btn").disabled = true;
    } else {
      $("update-btn").textContent = "Update";
      $("update-btn").disabled = false;
    }
    banner.dataset.updater = st.updater ? "1" : "";
    banner.dataset.url = st.update.url;
  } else {
    banner.hidden = true;
  }
}

$("update-btn").addEventListener("click", async () => {
  const banner = $("update");
  if (!banner.dataset.updater) {
    chrome.tabs.create({ url: "https://github.com/elkarbeenus/lakuenwatcher#installation" });
    return;
  }
  $("update-btn").disabled = true;
  const r = await chrome.runtime.sendMessage({ type: "installUpdate" });
  $("update-text").textContent = r && r.ok
    ? "Wird installiert … die Erweiterung startet gleich neu."
    : `Fehler: ${(r && r.error) || "unbekannt"}`;
});

$("next").addEventListener("click", async () => {
  const r = await chrome.runtime.sendMessage({ type: "nextNow", tabId });
  if (r && r.ok) window.close();
  else $("status").textContent = r && r.reason === "noNext" ? "Keine weitere Folge gefunden" : "Hier keine Serie erkannt";
});

$("reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "resetCount", tabId });
  // ---------- Fernseher (LakuenCast) ----------
let tv = null;
async function refreshTv() {
  tv = await chrome.runtime.sendMessage({ type: "castStatus", tabId });
  const btn = $("cast");
  const hint = $("tv-hint");
  hint.textContent = "";
  btn.classList.remove("stop");
  btn.disabled = false;
  if (!tv || !tv.running) {
    $("tv-state").textContent = "LakuenCast läuft nicht";
    btn.textContent = "An Fernseher senden";
    btn.disabled = true;
    hint.innerHTML = 'LakuenCast starten (<a href="https://github.com/elkarbeenus/LakuenCast" target="_blank">herunterladen</a>).';
    return;
  }
  const dev = tv.lc.selected;
  $("tv-state").textContent = dev ? dev.name : "kein Gerät gewählt";
  if (tv.casting) {
    btn.textContent = "■ Senden beenden";
    btn.classList.add("stop");
    hint.textContent = "Läuft auf dem Fernseher. Die nächste Folge kommt automatisch.";
  } else {
    btn.textContent = "📺 An Fernseher senden";
    if (!dev) { btn.disabled = true; hint.textContent = "In LakuenCast einen Fernseher auswählen."; }
    else if (!tv.hasVideo) hint.textContent = "Tipp: Das Video kurz anspielen, dann senden.";
  }
}

$("cast").addEventListener("click", async () => {
  const btn = $("cast");
  btn.disabled = true;
  if (tv && tv.casting) {
    await chrome.runtime.sendMessage({ type: "castStop", tabId });
  } else {
    btn.textContent = "Sende …";
    const r = await chrome.runtime.sendMessage({ type: "castNow", tabId });
    if (!r || !r.ok) {
      const reasons = {
        noVideo: "Kein Video gefunden. Video im Browser kurz starten, dann nochmal senden.",
        noLakuenCast: "LakuenCast läuft nicht.",
      };
      await refreshTv();
      $("tv-hint").textContent = reasons[r && r.reason] || `Fehler: ${(r && r.error) || "unbekannt"}`;
      return;
    }
  }
  await refreshTv();
  refresh();
});

refresh();
refreshTv();
setInterval(refreshTv, 3000);
});

$("check").addEventListener("click", async () => {
  $("check").textContent = "Suche …";
  const r = await chrome.runtime.sendMessage({ type: "checkUpdate" });
  $("check").textContent = r && r.ok ? (r.update ? "Update gefunden" : "Aktuell") : "GitHub nicht erreichbar";
  // ---------- Fernseher (LakuenCast) ----------
let tv = null;
async function refreshTv() {
  tv = await chrome.runtime.sendMessage({ type: "castStatus", tabId });
  const btn = $("cast");
  const hint = $("tv-hint");
  hint.textContent = "";
  btn.classList.remove("stop");
  btn.disabled = false;
  if (!tv || !tv.running) {
    $("tv-state").textContent = "LakuenCast läuft nicht";
    btn.textContent = "An Fernseher senden";
    btn.disabled = true;
    hint.innerHTML = 'LakuenCast starten (<a href="https://github.com/elkarbeenus/LakuenCast" target="_blank">herunterladen</a>).';
    return;
  }
  const dev = tv.lc.selected;
  $("tv-state").textContent = dev ? dev.name : "kein Gerät gewählt";
  if (tv.casting) {
    btn.textContent = "■ Senden beenden";
    btn.classList.add("stop");
    hint.textContent = "Läuft auf dem Fernseher. Die nächste Folge kommt automatisch.";
  } else {
    btn.textContent = "📺 An Fernseher senden";
    if (!dev) { btn.disabled = true; hint.textContent = "In LakuenCast einen Fernseher auswählen."; }
    else if (!tv.hasVideo) hint.textContent = "Tipp: Das Video kurz anspielen, dann senden.";
  }
}

$("cast").addEventListener("click", async () => {
  const btn = $("cast");
  btn.disabled = true;
  if (tv && tv.casting) {
    await chrome.runtime.sendMessage({ type: "castStop", tabId });
  } else {
    btn.textContent = "Sende …";
    const r = await chrome.runtime.sendMessage({ type: "castNow", tabId });
    if (!r || !r.ok) {
      const reasons = {
        noVideo: "Kein Video gefunden. Video im Browser kurz starten, dann nochmal senden.",
        noLakuenCast: "LakuenCast läuft nicht.",
      };
      await refreshTv();
      $("tv-hint").textContent = reasons[r && r.reason] || `Fehler: ${(r && r.error) || "unbekannt"}`;
      return;
    }
  }
  await refreshTv();
  refresh();
});

refresh();
refreshTv();
setInterval(refreshTv, 3000);
});

// ---------- Fernseher (LakuenCast) ----------
let tv = null;
async function refreshTv() {
  tv = await chrome.runtime.sendMessage({ type: "castStatus", tabId });
  const btn = $("cast");
  const hint = $("tv-hint");
  hint.textContent = "";
  btn.classList.remove("stop");
  btn.disabled = false;
  if (!tv || !tv.running) {
    $("tv-state").textContent = "LakuenCast läuft nicht";
    btn.textContent = "An Fernseher senden";
    btn.disabled = true;
    hint.innerHTML = 'LakuenCast starten (<a href="https://github.com/elkarbeenus/LakuenCast" target="_blank">herunterladen</a>).';
    return;
  }
  const dev = tv.lc.selected;
  $("tv-state").textContent = dev ? dev.name : "kein Gerät gewählt";
  if (tv.casting) {
    btn.textContent = "■ Senden beenden";
    btn.classList.add("stop");
    hint.textContent = "Läuft auf dem Fernseher. Die nächste Folge kommt automatisch.";
  } else {
    btn.textContent = "📺 An Fernseher senden";
    if (!dev) { btn.disabled = true; hint.textContent = "In LakuenCast einen Fernseher auswählen."; }
    else if (!tv.hasVideo) hint.textContent = "Tipp: Das Video kurz anspielen, dann senden.";
  }
}

$("cast").addEventListener("click", async () => {
  const btn = $("cast");
  btn.disabled = true;
  if (tv && tv.casting) {
    await chrome.runtime.sendMessage({ type: "castStop", tabId });
  } else {
    btn.textContent = "Sende …";
    const r = await chrome.runtime.sendMessage({ type: "castNow", tabId });
    if (!r || !r.ok) {
      const reasons = {
        noVideo: "Kein Video gefunden. Video im Browser kurz starten, dann nochmal senden.",
        noLakuenCast: "LakuenCast läuft nicht.",
      };
      await refreshTv();
      $("tv-hint").textContent = reasons[r && r.reason] || `Fehler: ${(r && r.error) || "unbekannt"}`;
      return;
    }
  }
  await refreshTv();
  refresh();
});

refresh();
refreshTv();
setInterval(refreshTv, 3000);
