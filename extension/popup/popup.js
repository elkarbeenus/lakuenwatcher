import { DEFAULTS, getSettings, setSettings } from "../lib/settings.js";
import { displayVersion } from "../lib/version.js";
import { episodeLabel, fmtTime } from "../lib/series.js";

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
  } else if (el.tagName === "SELECT" || el.type === "text") {
    el.value = settings[key];
    el.addEventListener("change", () => setSettings({ [key]: el.value }));
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
  if (s.status === "sleep") text = "😴 Sleep-Timer: angehalten";
  renderSleep(st.sleepUntil);
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
  // ---------- Sleep-Timer ----------
function renderSleep(until) {
  const info = $("sleep-info");
  if (until && until > Date.now()) {
    const t = new Date(until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    info.textContent = `Nach der Folge, die um ${t} läuft, ist Schluss.`;
    if (document.activeElement !== $("sleep") && $("sleep").value === "0") $("sleep").value = "custom";
  } else {
    info.textContent = "";
    if (document.activeElement !== $("sleep")) $("sleep").value = "0";
  }
}
{
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "läuft";
  custom.hidden = true;
  $("sleep").appendChild(custom);
}
$("sleep").addEventListener("change", async () => {
  const min = parseInt($("sleep").value, 10) || 0;
  if (min) await chrome.storage.local.set({ sleepUntil: Date.now() + min * 60_000 });
  else await chrome.storage.local.remove("sleepUntil");
  $("sleep").blur();
  refresh();
});

// ---------- Weiterschauen ----------
async function renderHistory() {
  const list = await chrome.runtime.sendMessage({ type: "history" });
  const box = $("history");
  const items = (list || []).slice(0, 5);
  box.hidden = !items.length;
  const wrap = $("history-list");
  wrap.innerHTML = "";
  for (const h of items) {
    const row = document.createElement("div");
    row.className = "h-item";
    row.innerHTML = `<div class="h-main"><div class="h-name"></div><div class="h-sub"></div>
      <div class="h-bar"><div></div></div></div><button class="h-x" title="Entfernen">✕</button>`;
    row.querySelector(".h-name").textContent = h.name;
    row.querySelector(".h-sub").textContent = `${episodeLabel(h)} · ${fmtTime(h.time)} / ${fmtTime(h.duration)}`;
    row.querySelector(".h-bar > div").style.width = `${Math.min(100, (100 * h.time) / (h.duration || 1))}%`;
    row.querySelector(".h-main").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "openHistory", key: h.key });
      window.close();
    };
    row.querySelector(".h-x").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "forgetHistory", key: h.key });
      renderHistory();
    };
    wrap.appendChild(row);
  }
}

// ---------- Für diese Serie ----------
let seriesKey = null;
async function renderSeries() {
  const r = await chrome.runtime.sendMessage({ type: "seriesOf", tabId });
  $("series").hidden = !(r && r.info);
  if (!r || !r.info) return;
  seriesKey = r.info.key;
  $("series-name").textContent = r.info.name;
  $("s-intro").value = r.own && r.own.introSkip != null ? r.own.introSkip : "";
  $("s-outro").value = r.own && r.own.outroSkip != null ? r.own.outroSkip : "";
  $("s-intro").placeholder = String(settings.introSkip || 0);
  $("s-outro").placeholder = String(settings.outroSkip || 0);
}
for (const [id, key] of [["s-intro", "introSkip"], ["s-outro", "outroSkip"]]) {
  $(id).addEventListener("change", () => {
    const v = $(id).value.trim();
    const n = v === "" ? null : Math.max(0, Math.min(600, parseInt(v, 10) || 0));
    if (n !== null) $(id).value = n;
    chrome.runtime.sendMessage({ type: "setSeries", key: seriesKey, values: { [key]: n } });
  });
}

renderHistory();
renderSeries();

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
  // ---------- Sleep-Timer ----------
function renderSleep(until) {
  const info = $("sleep-info");
  if (until && until > Date.now()) {
    const t = new Date(until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    info.textContent = `Nach der Folge, die um ${t} läuft, ist Schluss.`;
    if (document.activeElement !== $("sleep") && $("sleep").value === "0") $("sleep").value = "custom";
  } else {
    info.textContent = "";
    if (document.activeElement !== $("sleep")) $("sleep").value = "0";
  }
}
{
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "läuft";
  custom.hidden = true;
  $("sleep").appendChild(custom);
}
$("sleep").addEventListener("change", async () => {
  const min = parseInt($("sleep").value, 10) || 0;
  if (min) await chrome.storage.local.set({ sleepUntil: Date.now() + min * 60_000 });
  else await chrome.storage.local.remove("sleepUntil");
  $("sleep").blur();
  refresh();
});

// ---------- Weiterschauen ----------
async function renderHistory() {
  const list = await chrome.runtime.sendMessage({ type: "history" });
  const box = $("history");
  const items = (list || []).slice(0, 5);
  box.hidden = !items.length;
  const wrap = $("history-list");
  wrap.innerHTML = "";
  for (const h of items) {
    const row = document.createElement("div");
    row.className = "h-item";
    row.innerHTML = `<div class="h-main"><div class="h-name"></div><div class="h-sub"></div>
      <div class="h-bar"><div></div></div></div><button class="h-x" title="Entfernen">✕</button>`;
    row.querySelector(".h-name").textContent = h.name;
    row.querySelector(".h-sub").textContent = `${episodeLabel(h)} · ${fmtTime(h.time)} / ${fmtTime(h.duration)}`;
    row.querySelector(".h-bar > div").style.width = `${Math.min(100, (100 * h.time) / (h.duration || 1))}%`;
    row.querySelector(".h-main").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "openHistory", key: h.key });
      window.close();
    };
    row.querySelector(".h-x").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "forgetHistory", key: h.key });
      renderHistory();
    };
    wrap.appendChild(row);
  }
}

// ---------- Für diese Serie ----------
let seriesKey = null;
async function renderSeries() {
  const r = await chrome.runtime.sendMessage({ type: "seriesOf", tabId });
  $("series").hidden = !(r && r.info);
  if (!r || !r.info) return;
  seriesKey = r.info.key;
  $("series-name").textContent = r.info.name;
  $("s-intro").value = r.own && r.own.introSkip != null ? r.own.introSkip : "";
  $("s-outro").value = r.own && r.own.outroSkip != null ? r.own.outroSkip : "";
  $("s-intro").placeholder = String(settings.introSkip || 0);
  $("s-outro").placeholder = String(settings.outroSkip || 0);
}
for (const [id, key] of [["s-intro", "introSkip"], ["s-outro", "outroSkip"]]) {
  $(id).addEventListener("change", () => {
    const v = $(id).value.trim();
    const n = v === "" ? null : Math.max(0, Math.min(600, parseInt(v, 10) || 0));
    if (n !== null) $(id).value = n;
    chrome.runtime.sendMessage({ type: "setSeries", key: seriesKey, values: { [key]: n } });
  });
}

renderHistory();
renderSeries();

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

// ---------- Sleep-Timer ----------
function renderSleep(until) {
  const info = $("sleep-info");
  if (until && until > Date.now()) {
    const t = new Date(until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    info.textContent = `Nach der Folge, die um ${t} läuft, ist Schluss.`;
    if (document.activeElement !== $("sleep") && $("sleep").value === "0") $("sleep").value = "custom";
  } else {
    info.textContent = "";
    if (document.activeElement !== $("sleep")) $("sleep").value = "0";
  }
}
{
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "läuft";
  custom.hidden = true;
  $("sleep").appendChild(custom);
}
$("sleep").addEventListener("change", async () => {
  const min = parseInt($("sleep").value, 10) || 0;
  if (min) await chrome.storage.local.set({ sleepUntil: Date.now() + min * 60_000 });
  else await chrome.storage.local.remove("sleepUntil");
  $("sleep").blur();
  refresh();
});

// ---------- Weiterschauen ----------
async function renderHistory() {
  const list = await chrome.runtime.sendMessage({ type: "history" });
  const box = $("history");
  const items = (list || []).slice(0, 5);
  box.hidden = !items.length;
  const wrap = $("history-list");
  wrap.innerHTML = "";
  for (const h of items) {
    const row = document.createElement("div");
    row.className = "h-item";
    row.innerHTML = `<div class="h-main"><div class="h-name"></div><div class="h-sub"></div>
      <div class="h-bar"><div></div></div></div><button class="h-x" title="Entfernen">✕</button>`;
    row.querySelector(".h-name").textContent = h.name;
    row.querySelector(".h-sub").textContent = `${episodeLabel(h)} · ${fmtTime(h.time)} / ${fmtTime(h.duration)}`;
    row.querySelector(".h-bar > div").style.width = `${Math.min(100, (100 * h.time) / (h.duration || 1))}%`;
    row.querySelector(".h-main").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "openHistory", key: h.key });
      window.close();
    };
    row.querySelector(".h-x").onclick = async () => {
      await chrome.runtime.sendMessage({ type: "forgetHistory", key: h.key });
      renderHistory();
    };
    wrap.appendChild(row);
  }
}

// ---------- Für diese Serie ----------
let seriesKey = null;
async function renderSeries() {
  const r = await chrome.runtime.sendMessage({ type: "seriesOf", tabId });
  $("series").hidden = !(r && r.info);
  if (!r || !r.info) return;
  seriesKey = r.info.key;
  $("series-name").textContent = r.info.name;
  $("s-intro").value = r.own && r.own.introSkip != null ? r.own.introSkip : "";
  $("s-outro").value = r.own && r.own.outroSkip != null ? r.own.outroSkip : "";
  $("s-intro").placeholder = String(settings.introSkip || 0);
  $("s-outro").placeholder = String(settings.outroSkip || 0);
}
for (const [id, key] of [["s-intro", "introSkip"], ["s-outro", "outroSkip"]]) {
  $(id).addEventListener("change", () => {
    const v = $(id).value.trim();
    const n = v === "" ? null : Math.max(0, Math.min(600, parseInt(v, 10) || 0));
    if (n !== null) $(id).value = n;
    chrome.runtime.sendMessage({ type: "setSeries", key: seriesKey, values: { [key]: n } });
  });
}

renderHistory();
renderSeries();

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
