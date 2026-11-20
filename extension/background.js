// LakuenWatcher – Hintergrund (Service Worker)
//
// Ablauf:
//  1. content/frame.js (läuft in jedem Frame, auch im Player-iframe des
//     Hosters) meldet "videoEnded".
//  2. Hier wird geprüft: an? "Stopp nach X Folgen" erreicht?
//  3. Dann bekommt der Hauptframe des Tabs (content/page.js) "goNext" und
//     öffnet die nächste Folge im selben Tab.
//  4. Der Tab wird als "autoplay ausstehend" markiert, damit der neue Player
//     von selbst startet.

import { getSettings, REPO } from "./lib/settings.js";
import { isNewer, displayVersion } from "./lib/version.js";

const AUTOPLAY_WINDOW_MS = 90_000;   // So lange nach einem Wechsel wird Autoplay versucht
const ENDED_DEBOUNCE_MS = 15_000;    // Doppelte Ende-Meldungen eines Tabs ignorieren

// ---------- Tab-Zustand (storage.session überlebt das Einschlafen des Workers) ----------

async function getTabState(tabId) {
  const key = `tab_${tabId}`;
  const data = await chrome.storage.session.get(key);
  return data[key] || { count: 0, pendingAutoplay: 0, lastEnded: 0, status: "" };
}

async function setTabState(tabId, patch) {
  const key = `tab_${tabId}`;
  const state = { ...(await getTabState(tabId)), ...patch };
  await chrome.storage.session.set({ [key]: state });
  await updateBadge(tabId, state);
  return state;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab_${tabId}`);
});

async function updateBadge(tabId, state) {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  let text = "";
  let color = "#7c5cff";
  if (state.status === "stopped") { text = "STOP"; color = "#e5484d"; }
  else if (state.status === "end") { text = "ENDE"; color = "#e5484d"; }
  else if (state.count > 0) { text = String(state.count); }
  else if (updateAvailable) { text = "NEU"; color = "#30a46c"; }
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (_) { /* Tab schon zu */ }
}

// ---------- Nächste Folge ----------

async function goNext(tabId, { manual = false } = {}) {
  const settings = await getSettings();
  const state = await getTabState(tabId);

  if (!manual) {
    if (!settings.enabled) return { ok: false, reason: "disabled" };
    if (Date.now() - state.lastEnded < ENDED_DEBOUNCE_MS) return { ok: false, reason: "debounce" };
    if (settings.stopAfter > 0 && state.count >= settings.stopAfter) {
      await setTabState(tabId, { status: "stopped", lastEnded: Date.now(), pendingAutoplay: 0 });
      return { ok: false, reason: "stopAfter" };
    }
  }

  let reply;
  try {
    reply = await chrome.tabs.sendMessage(
      tabId,
      { type: "goNext", countdown: manual ? 0 : settings.countdown },
      { frameId: 0 }
    );
  } catch (e) {
    reply = { ok: false, reason: "noPageScript" };
  }

  if (reply && reply.ok) {
    await setTabState(tabId, {
      count: manual ? state.count : state.count + 1,
      lastEnded: Date.now(),
      pendingAutoplay: settings.autoplay ? Date.now() : 0,
      status: "",
    });
  } else if (reply && reply.reason === "noNext") {
    await setTabState(tabId, { status: "end", lastEnded: Date.now(), pendingAutoplay: 0 });
  }
  return reply || { ok: false, reason: "unknown" };
}

// ---------- Nachrichten ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // asynchron antworten
});

async function handleMessage(msg, sender) {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;

  switch (msg.type) {
    case "videoEnded":
      return goNext(tabId);

    case "hello": {
      // Ein Frame fragt beim Laden: soll ich automatisch starten?
      const state = await getTabState(tabId);
      const autoplay = state.pendingAutoplay > 0 && Date.now() - state.pendingAutoplay < AUTOPLAY_WINDOW_MS;
      return { autoplay };
    }

    case "playing": {
      const state = await getTabState(tabId);
      if (state.pendingAutoplay) await setTabState(tabId, { pendingAutoplay: 0 });
      return { ok: true };
    }

    case "cancelled":
      await setTabState(tabId, { pendingAutoplay: 0, count: Math.max(0, (await getTabState(tabId)).count - 1) });
      return { ok: true };

    // --- vom Popup ---
    case "status": {
      const state = await getTabState(msg.tabId);
      const upd = await chrome.storage.local.get(["updateAvailable", "updateRequestedAt"]);
      const updater = await hasUpdater();
      return {
        state,
        version: chrome.runtime.getManifest().version_name,
        update: upd.updateAvailable || null,
        updateRequestedAt: upd.updateRequestedAt || 0,
        updater,
      };
    }
    case "nextNow":
      return goNext(msg.tabId, { manual: true });
    case "resetCount":
      await setTabState(msg.tabId, { count: 0, status: "" });
      return { ok: true };
    case "checkUpdate":
      return checkForUpdate({ force: true });
    case "installUpdate":
      return requestUpdate();
  }
  return { ok: false, reason: "unknownMessage" };
}

// ---------- Update von GitHub ----------
//
// Die Erweiterung ist "entpackt" in Brave geladen (Ordner ~/LakuenWatcher/extension).
// Erweiterungen dürfen keine Dateien auf der Platte überschreiben. Deshalb:
//  - Klick auf "Update" legt über die Download-Funktion eine kleine Datei
//    ~/Downloads/LakuenWatcher-Update/request.json an.
//  - Ein systemd-User-Dienst (von install.sh eingerichtet) bemerkt die Datei,
//    lädt das Release von GitHub, prüft SHA-256 und ersetzt den Ordnerinhalt.
//  - Die Erweiterung merkt, dass ihre manifest.json auf der Platte neuer ist,
//    und lädt sich selbst neu. Einstellungen bleiben erhalten.

async function checkForUpdate({ force = false } = {}) {
  const settings = await getSettings();
  if (!settings.updateCheck && !force) return { ok: true, skipped: true };

  const installed = chrome.runtime.getManifest().version_name;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub antwortet ${res.status}`);
    const rel = await res.json();
    const latest = rel.tag_name;
    if (isNewer(latest, installed)) {
      const info = {
        version: latest,
        display: displayVersion(latest),
        url: rel.html_url,
        notes: (rel.body || "").split("\n").find((l) => l.trim()) || "",
      };
      await chrome.storage.local.set({ updateAvailable: info });
      return { ok: true, update: info };
    }
    await chrome.storage.local.remove("updateAvailable");
    return { ok: true, update: null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function hasUpdater() {
  // update.sh schreibt updater.json in den Erweiterungsordner.
  try {
    const res = await fetch(chrome.runtime.getURL("updater.json"), { cache: "no-store" });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function requestUpdate() {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  const body = JSON.stringify({ version: updateAvailable ? updateAvailable.version : "latest", requestedAt: Date.now() });
  try {
    const id = await chrome.downloads.download({
      url: "data:application/json;charset=utf-8," + encodeURIComponent(body),
      filename: "LakuenWatcher-Update/request.json",
      conflictAction: "overwrite",
      saveAs: false,
    });
    // Eintrag aus der Download-Liste entfernen, die Datei bleibt liegen.
    setTimeout(() => chrome.downloads.erase({ id }).catch(() => {}), 3000);
    await chrome.storage.local.set({ updateRequestedAt: Date.now() });
    chrome.alarms.create("selfcheck-fast", { periodInMinutes: 0.5 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function reloadIfFilesChanged() {
  try {
    const res = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    const onDisk = await res.json();
    const running = chrome.runtime.getManifest();
    if (onDisk.version_name !== running.version_name || onDisk.version !== running.version) {
      await chrome.storage.local.remove(["updateAvailable", "updateRequestedAt"]);
      chrome.runtime.reload();
    }
  } catch (_) { /* Dateien werden gerade ersetzt – beim nächsten Mal */ }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "selfcheck" || alarm.name === "selfcheck-fast") {
    await reloadIfFilesChanged();
    const { updateRequestedAt } = await chrome.storage.local.get("updateRequestedAt");
    if (alarm.name === "selfcheck-fast" && (!updateRequestedAt || Date.now() - updateRequestedAt > 5 * 60_000)) {
      chrome.alarms.clear("selfcheck-fast");
    }
  }
  if (alarm.name === "updatecheck") await checkForUpdate();
});

function setup() {
  chrome.alarms.create("selfcheck", { periodInMinutes: 1 });
  chrome.alarms.create("updatecheck", { periodInMinutes: 360 });
  checkForUpdate();
}

chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(setup);
