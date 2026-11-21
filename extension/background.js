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
import { seriesInfo } from "./lib/series.js";
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
  else if (state.status === "sleep") { text = "ZZZ"; color = "#e5484d"; }
  else if (state.status === "end") { text = "ENDE"; color = "#e5484d"; }
  else if (state.casting) { text = "TV"; color = "#30a46c"; }
  else if (state.count > 0) { text = String(state.count); }
  else if (updateAvailable) { text = "NEU"; color = "#30a46c"; }
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (_) { /* Tab schon zu */ }
}

// ---------- Nächste Folge ----------

async function goNext(tabId, { manual = false, fromCast = false } = {}) {
  const settings = await getSettings();
  const state = await getTabState(tabId);

  if (!manual) {
    if (!settings.enabled) return { ok: false, reason: "disabled" };
    if (Date.now() - state.lastEnded < ENDED_DEBOUNCE_MS) return { ok: false, reason: "debounce" };
    const { sleepUntil } = await chrome.storage.local.get("sleepUntil");
    if (sleepUntil && Date.now() >= sleepUntil) {
      await chrome.storage.local.remove("sleepUntil");
      await setTabState(tabId, { status: "sleep", lastEnded: Date.now(), pendingAutoplay: 0, pendingCast: 0 });
      return { ok: false, reason: "sleep" };
    }
    if (settings.stopAfter > 0 && state.count >= settings.stopAfter) {
      await setTabState(tabId, { status: "stopped", lastEnded: Date.now(), pendingAutoplay: 0 });
      return { ok: false, reason: "stopAfter" };
    }
  }

  let reply;
  try {
    reply = await chrome.tabs.sendMessage(
      tabId,
      { type: "goNext", countdown: manual || fromCast ? 0 : settings.countdown },
      { frameId: 0 }
    );
  } catch (e) {
    reply = { ok: false, reason: "noPageScript" };
  }

  if (reply && reply.ok) {
    await setTabState(tabId, {
      count: manual ? state.count : state.count + 1,
      lastEnded: Date.now(),
      pendingAutoplay: settings.autoplay || state.casting ? Date.now() : 0,
      pendingCast: state.casting ? Date.now() : 0,
      status: "",
    });
  } else if (reply && reply.reason === "noNext") {
    await setTabState(tabId, { status: "end", lastEnded: Date.now(), pendingAutoplay: 0, pendingCast: 0 });
  }
  return reply || { ok: false, reason: "unknown" };
}

// ---------- Pro Serie, Weiterschauen, Intro überspringen ----------

async function effective(tabUrl) {
  const settings = await getSettings();
  const info = seriesInfo(tabUrl || "");
  const { series = {} } = await chrome.storage.local.get("series");
  const own = info ? series[info.key] || {} : {};
  return {
    introSkip: own.introSkip ?? settings.introSkip,
    outroSkip: own.outroSkip ?? settings.outroSkip,
    keys: settings.keys,
  };
}

async function getHistory() {
  const { history = {} } = await chrome.storage.local.get("history");
  return Object.values(history).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveProgress(tab, time, duration) {
  if (!tab || !Number.isFinite(time) || !Number.isFinite(duration) || duration < 180) return;
  const info = seriesInfo(tab.url);
  if (!info) return;
  const { history = {} } = await chrome.storage.local.get("history");
  history[info.key] = {
    key: info.key, name: info.name, url: tab.url, season: info.season, episode: info.episode,
    time: Math.floor(time), duration: Math.floor(duration), updatedAt: Date.now(),
  };
  // Nur die letzten 30 Serien behalten
  const keys = Object.values(history).sort((a, b) => b.updatedAt - a.updatedAt).slice(30).map((h) => h.key);
  keys.forEach((k) => delete history[k]);
  await chrome.storage.local.set({ history });
}

async function resumePoint(tabUrl) {
  const settings = await getSettings();
  if (!settings.resume || !tabUrl) return 0;
  const info = seriesInfo(tabUrl);
  if (!info) return 0;
  const { history = {} } = await chrome.storage.local.get("history");
  const h = history[info.key];
  if (!h || h.url !== tabUrl) return 0;
  // Nur wenn mittendrin: nicht ganz am Anfang und nicht im Abspann
  return h.time > 30 && h.time < h.duration - 90 ? h.time : 0;
}

async function skipIntro(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const eff = await effective(tab ? tab.url : "");
  try { await chrome.tabs.sendMessage(tabId, { type: "skipIntro", introSkip: eff.introSkip }); } catch (_) {}
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === "next-episode") goNext(tab.id, { manual: true });
  if (command === "skip-intro") skipIntro(tab.id);
});

// ---------- Nachrichten ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // asynchron antworten
});

async function handleMessage(msg, sender) {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;

  switch (msg.type) {
    case "videoEnded": {
      const st = await getTabState(tabId);
      if (st.casting) return { ok: false, reason: "casting" }; // Ende kommt vom Fernseher
      return goNext(tabId);
    }

    case "videoSrc":
      // Direkte Video-Adresse aus dem Player (z. B. .mp4)
      await rememberMedia(tabId, { url: msg.url, kind: "video", headers: { Referer: msg.referer || "" } });
      return { ok: true };

    case "pageSwitched":
      // Folge ohne Neuladen gewechselt → alte Video-Adressen vergessen
      await chrome.storage.session.remove(`media_${tabId}`);
      return { ok: true };

    case "castTick":
      // Content-Script im gecasteten Tab hält uns wach und lässt uns LakuenCast abfragen
      await pollCast();
      return { ok: true };

    case "hello": {
      // Ein Frame fragt beim Laden: soll ich automatisch starten? Wo weiterschauen?
      const state = await getTabState(tabId);
      const autoplay = state.pendingAutoplay > 0 && Date.now() - state.pendingAutoplay < AUTOPLAY_WINDOW_MS;
      const tabUrl = sender.tab ? sender.tab.url : "";
      return { autoplay, castMode: !!state.casting, ...(await effective(tabUrl)), resumeAt: await resumePoint(tabUrl) };
    }

    case "effective":
      return effective(sender.tab ? sender.tab.url : "");

    case "progress":
      await saveProgress(sender.tab, msg.time, msg.duration);
      return { ok: true };

    case "playerFailed":
      // Hoster lädt nicht → Hauptseite soll den nächsten Hoster probieren
      await setTabState(tabId, { pendingAutoplay: Date.now() });
      try { return await chrome.tabs.sendMessage(tabId, { type: "tryNextHoster" }, { frameId: 0 }); }
      catch (_) { return { ok: false }; }

    case "keyNext":
      return goNext(tabId, { manual: true });

    case "keySkipIntro":
      await skipIntro(tabId);
      return { ok: true };

    case "history":
      return getHistory();

    case "openHistory": {
      const entry = (await getHistory()).find((h) => h.key === msg.key);
      if (!entry) return { ok: false };
      const tab = await chrome.tabs.create({ url: entry.url });
      await setTabState(tab.id, { pendingAutoplay: Date.now() });
      return { ok: true };
    }

    case "forgetHistory": {
      const { history = {} } = await chrome.storage.local.get("history");
      delete history[msg.key];
      await chrome.storage.local.set({ history });
      return { ok: true };
    }

    case "seriesOf": {
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      const info = tab ? seriesInfo(tab.url) : null;
      const { series = {} } = await chrome.storage.local.get("series");
      return { info, own: info ? series[info.key] || null : null };
    }

    case "setSeries": {
      const { series = {} } = await chrome.storage.local.get("series");
      const own = { ...(series[msg.key] || {}), ...msg.values };
      for (const k of Object.keys(own)) if (own[k] === null || own[k] === "") delete own[k];
      if (Object.keys(own).length) series[msg.key] = own; else delete series[msg.key];
      await chrome.storage.local.set({ series });
      return { ok: true };
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
      const upd = await chrome.storage.local.get(["updateAvailable", "updateRequestedAt", "sleepUntil"]);
      const updater = await hasUpdater();
      return {
        state,
        version: chrome.runtime.getManifest().version_name,
        update: upd.updateAvailable || null,
        updateRequestedAt: upd.updateRequestedAt || 0,
        updater,
        sleepUntil: upd.sleepUntil || 0,
      };
    }
    case "castStatus":
      return castStatus(msg.tabId);
    case "castNow":
      return castTab(msg.tabId, { manual: true });
    case "castStop":
      return stopCast(msg.tabId);
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

// ---------- An den Fernseher senden (LakuenCast) ----------
//
// LakuenCast (eigenes Programm, github.com/elkarbeenus/LakuenCast) läuft auf dem PC
// und spricht mit dem Chromecast. Wir merken uns, welche Video-Adressen der Player
// lädt (.m3u8/.mp4), und schicken die passende samt Referer/Cookies an LakuenCast.
// Ist die Folge auf dem Fernseher zu Ende, öffnen wir die nächste Folge im Tab,
// spielen sie stumm kurz an, fangen die neue Adresse ab und senden sie hinterher.

const LAKUENCAST = "http://127.0.0.1:47800";
const MEDIA_RE = /\.(m3u8|mp4)(\?|#|$)/i;
const SKIP_RE = /(ads?|preroll|vast|banner|promo)[\/._-]/i;

async function lcFetch(path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), body ? 30000 : 2000);
  try {
    const res = await fetch(LAKUENCAST + path, body ? {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LakuenCast": "1" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    } : { cache: "no-store", signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getMedia(tabId) {
  const key = `media_${tabId}`;
  return (await chrome.storage.session.get(key))[key] || [];
}

async function rememberMedia(tabId, item) {
  if (!item.url || !/^https?:/.test(item.url) || SKIP_RE.test(item.url)) return;
  const key = `media_${tabId}`;
  const list = await getMedia(tabId);
  if (list.some((m) => m.url === item.url)) return;
  list.push({ ...item, ts: Date.now() });
  await chrome.storage.session.set({ [key]: list.slice(-15) });

  const state = await getTabState(tabId);
  if (state.pendingCast && Date.now() - state.pendingCast < AUTOPLAY_WINDOW_MS) {
    // Neue Folge lädt: kurz warten, bis auch die Haupt-Playlist da ist, dann senden
    clearTimeout(rememberMedia.timer);
    rememberMedia.timer = setTimeout(() => castTab(tabId).catch(() => {}), 1500);
  }
}

function pickMedia(list) {
  const m3u8 = list.filter((m) => /\.m3u8/i.test(m.url));
  if (m3u8.length) {
    return m3u8.find((m) => /master|playlist|index/i.test(m.url)) || m3u8[0];
  }
  const mp4 = list.filter((m) => /\.mp4/i.test(m.url));
  return mp4[mp4.length - 1] || null;
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0 || !MEDIA_RE.test(details.url)) return;
    const headers = {};
    for (const h of details.requestHeaders || []) {
      const name = h.name.toLowerCase();
      if (["referer", "user-agent", "cookie", "origin"].includes(name)) headers[h.name] = h.value;
    }
    const kind = /\.m3u8/i.test(details.url) ? "hls" : "mp4";
    rememberMedia(details.tabId, { url: details.url, kind, headers });
  },
  { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] },
  ["requestHeaders", "extraHeaders"]
);

// Neue Seite im Tab → alte Video-Adressen vergessen
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) chrome.storage.session.remove(`media_${tabId}`);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`media_${tabId}`);
});

async function setCastMode(tabId, on) {
  try { await chrome.tabs.sendMessage(tabId, { type: "castMode", on }); } catch (_) { /* Seite lädt gerade */ }
}

async function castTab(tabId, { manual = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const media = pickMedia(await getMedia(tabId));
  if (!media) return { ok: false, reason: "noVideo" };

  let lc;
  try { lc = await lcFetch("/api/status"); } catch (_) { return { ok: false, reason: "noLakuenCast" }; }

  const headers = { ...media.headers };
  if (!headers.Referer && !headers.referer) headers.Referer = tab.url;

  // Mitten in der Folge? Dann am Fernseher an derselben Stelle weitermachen
  let startAt = 0;
  try {
    const pos = await chrome.tabs.sendMessage(tabId, { type: "getTime" });
    if (pos && pos.time > 3 && pos.time < pos.duration - 20) startAt = Math.floor(pos.time);
  } catch (_) { /* kein Video im Tab */ }

  let r;
  try {
    r = await lcFetch("/api/cast", { url: media.url, headers, title: tab.title || "", startAt });
  } catch (e) {
    return { ok: false, reason: "error", error: String(e.message || e) };
  }
  if (!r.ok) {
    await setTabState(tabId, { pendingCast: 0 });
    return { ok: false, reason: "error", error: r.error };
  }
  await setTabState(tabId, {
    casting: true,
    pendingCast: 0,
    pendingAutoplay: 0,
    castSeq: r.status ? r.status.finishedSeq : lc.finishedSeq,
    castNextSeq: (r.status ? r.status.nextSeq : lc.nextSeq) || 0,
    ...(manual ? { count: 0, status: "" } : {}),
  });
  await chrome.storage.session.set({ castTabId: tabId });
  await setCastMode(tabId, true);
  chrome.alarms.create("castpoll", { periodInMinutes: 0.5 });
  return { ok: true };
}

async function stopCast(tabId) {
  // Stelle am Fernseher merken, damit es im Browser dort weitergeht
  let resumeAt = 0;
  try {
    const lc = await lcFetch("/api/status");
    if (lc.mode === "casting" && lc.media && lc.media.currentTime > 3) resumeAt = lc.media.currentTime;
  } catch (_) { /* LakuenCast schon zu */ }
  try { await lcFetch("/api/stop", {}); } catch (_) { /* LakuenCast schon zu */ }
  await setTabState(tabId, { casting: false, pendingCast: 0 });
  await chrome.storage.session.remove("castTabId");
  await setCastMode(tabId, false);
  chrome.alarms.clear("castpoll");
  if (resumeAt) {
    try { await chrome.tabs.sendMessage(tabId, { type: "resumeLocal", time: resumeAt }); } catch (_) {}
  }
  return { ok: true, resumeAt };
}

async function castStatus(tabId) {
  let lc = null;
  try { lc = await lcFetch("/api/status"); } catch (_) { /* läuft nicht */ }
  const state = await getTabState(tabId);
  const media = pickMedia(await getMedia(tabId));
  return { running: !!lc, lc, casting: !!state.casting, hasVideo: !!media };
}

let polling = false;
async function pollCast() {
  if (polling) return;
  polling = true;
  try {
    const { castTabId } = await chrome.storage.session.get("castTabId");
    if (castTabId === undefined) { chrome.alarms.clear("castpoll"); return; }
    const state = await getTabState(castTabId);
    let lc;
    try { lc = await lcFetch("/api/status"); } catch (_) { return; }

    // Stand fürs Weiterschauen auch beim Casten merken
    if (lc.mode === "casting" && lc.media && lc.media.duration && !state.pendingCast) {
      const tab = await chrome.tabs.get(castTabId).catch(() => null);
      if (tab) await saveProgress(tab, lc.media.currentTime, lc.media.duration);
    }

    // Weiter-Knopf auf der Handy-Fernbedienung (LakuenCast)
    if (lc.nextSeq && lc.nextSeq > (state.castNextSeq || 0)) {
      const first = state.castNextSeq === undefined;
      await setTabState(castTabId, { castNextSeq: lc.nextSeq });
      if (!first) { await goNext(castTabId, { manual: true }); return; }
    }

    if (lc.finishedSeq > (state.castSeq || 0)) {
      await setTabState(castTabId, { castSeq: lc.finishedSeq });
      const r = await goNext(castTabId, { fromCast: true });
      if (!r.ok) {
        // Ende der Serie oder "Stopp nach X Folgen"
        await setTabState(castTabId, { casting: false });
        await chrome.storage.session.remove("castTabId");
      }
      return;
    }
    // In LakuenCast auf Stopp gedrückt?
    if (lc.mode === "idle" && !state.pendingCast && state.casting) {
      await setTabState(castTabId, { casting: false });
      await chrome.storage.session.remove("castTabId");
      await setCastMode(castTabId, false);
    }
  } finally {
    polling = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "castpoll") pollCast();
});
