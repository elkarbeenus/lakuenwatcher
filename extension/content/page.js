// LakuenWatcher – läuft im Hauptframe jeder Seite.
// Findet die nächste Folge über die Seiten-Profile, zeigt einen kurzen
// Countdown mit "Abbrechen" und öffnet dann die nächste Folge im selben Tab.
(() => {
  if (window.top !== window || window.__lakuenWatcherPage) return;
  window.__lakuenWatcherPage = true;

  const { profileFor } = globalThis.LW_PROFILES;
  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  const send = (msg) => alive() ? chrome.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null);

  function allLinks() {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.href)
      .filter((h) => h.startsWith("http"));
  }

  const NEXT_TEXT = /^\s*(nächste\s+(folge|episode)|naechste\s+folge|next\s+episode|next|weiter)\s*[›»>→]?\s*$/i;

  function findNextButton() {
    const els = document.querySelectorAll("a, button, [role='button']");
    for (const el of els) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
      if (label.length < 60 && NEXT_TEXT.test(label) && el.offsetParent !== null) return el;
    }
    const rel = document.querySelector("a[rel='next']");
    return rel || null;
  }

  // Ergebnis: { url } | { click: Element } | null (keine nächste Folge)
  function findNext() {
    const links = allLinks();
    const url = location.href;
    for (const profile of profileFor(location.hostname)) {
      const r = profile.findNext(links, url);
      if (typeof r === "string") return { url: r, profile: profile.id, profileObj: profile };
      if (r === null) return null; // Profil ist sicher: Serie zu Ende
    }
    const btn = findNextButton();
    return btn ? { click: btn, profile: "button" } : null;
  }

  // ---------- Countdown-Hinweis ----------

  let pending = null;

  function showToast(seconds, label, onDone, onCancel) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .box{font:14px/1.4 system-ui,sans-serif;background:#16141f;color:#fff;border:1px solid #7c5cff;
             border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;gap:12px;align-items:center}
        .t{font-weight:600}.s{opacity:.75;font-size:12px}
        button{font:inherit;background:#2a2638;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
        button.go{background:#7c5cff}
      </style>
      <div class="box">
        <div><div class="t">Nächste Folge in <span id="n">${seconds}</span> s</div><div class="s"></div></div>
        <button class="go" id="go">Jetzt</button><button id="x">Abbrechen</button>
      </div>`;
    root.querySelector(".s").textContent = label;
    document.documentElement.appendChild(host);

    let left = seconds;
    const timer = setInterval(() => {
      left--;
      root.getElementById("n").textContent = String(left);
      if (left <= 0) finish(onDone);
    }, 1000);
    function finish(fn) { clearInterval(timer); host.remove(); pending = null; fn(); }
    root.getElementById("go").onclick = () => finish(onDone);
    root.getElementById("x").onclick = () => finish(onCancel);
    return { cancel: () => finish(() => {}) };
  }

  // ---------- Wechsel ohne Neuladen ----------
  // Brave/Chrome lassen ein Video nur mit Ton von selbst starten, wenn auf der Seite
  // vorher geklickt wurde. Bei einem normalen Seitenwechsel geht dieser Klick verloren.
  // Darum: nächste Folgenseite im Hintergrund laden, nur den Player-Rahmen austauschen
  // und die Adresse anpassen. Der Klick von vorher gilt weiter.

  const AD_RE = /(ads?|banner|doubleclick|popunder|track)[\/._-]/i;

  function playerIframes(doc) {
    return Array.from(doc.querySelectorAll("iframe")).filter((f) => {
      const src = f.getAttribute("src") || f.getAttribute("data-src") || "";
      return src && !src.startsWith("about:") && !src.startsWith("javascript:") && !AD_RE.test(src);
    });
  }

  function currentPlayer() {
    let best = null, bestArea = 0;
    for (const f of playerIframes(document)) {
      const r = f.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = f; bestArea = area; }
    }
    return bestArea > 40000 ? best : null; // mind. ca. 250×160
  }

  function sameSeason(a, b) {
    const s = (u) => (u.match(/staffel-(\d+)|-s(\d+)e\d+/i) || []).slice(1).find(Boolean);
    return s(a) !== undefined && s(a) === s(b);
  }

  const ALLOW = ["autoplay", "fullscreen", "encrypted-media", "picture-in-picture"];

  async function switchInPlace(url, profile) {
    if (!profile || !profile.inPlace || !sameSeason(location.href, url)) return false;
    const cur = currentPlayer();
    if (!cur) return false;
    const curIndex = playerIframes(document).indexOf(cur);

    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return false;
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const candidates = playerIframes(doc);
    const preferred = (profile.playerSelectors || []).map((sel) => doc.querySelector(sel)).find(Boolean);
    const next = preferred || candidates[curIndex] || candidates[0];
    if (!next) return false;
    const src = new URL(next.getAttribute("src") || next.getAttribute("data-src"), url).href;
    if (src === cur.src) return false;

    // Autoplay-Erlaubnis an den neuen Player weitergeben
    const allow = new Set((cur.getAttribute("allow") || "").split(";").map((x) => x.trim()).filter(Boolean));
    ALLOW.forEach((a) => allow.add(a));
    cur.setAttribute("allow", Array.from(allow).join("; "));
    cur.setAttribute("allowfullscreen", "");
    cur.src = src;

    history.pushState({ lakuenWatcher: true }, "", url);
    document.title = doc.title;
    for (const sel of profile.textSelectors || ["h1", "h2"]) {
      const a = document.querySelector(sel);
      const b = doc.querySelector(sel);
      if (a && b) a.innerHTML = b.innerHTML;
    }
    // Markierung in der Folgenliste nachziehen
    document.querySelectorAll("a[href]").forEach((a) => {
      const active = a.href === url;
      const was = a.href === lastUrl;
      if (active || was) {
        const target = a.closest("li") || a;
        const nextTwin = Array.from(doc.querySelectorAll(`a[href="${a.getAttribute("href")}"]`))[0];
        const twinTarget = nextTwin && (nextTwin.closest("li") || nextTwin);
        if (twinTarget) { target.className = twinTarget.className; a.className = nextTwin.className; }
      }
    });
    lastUrl = url;
    send({ type: "pageSwitched", url });
    return true;
  }

  let lastUrl = location.href;
  window.addEventListener("popstate", (e) => {
    // Zurück-Taste nach einem Wechsel ohne Neuladen → Seite richtig laden
    if (e.state && e.state.lakuenWatcher || lastUrl !== location.href) location.reload();
  });

  async function open(next) {
    if (next.url) {
      let done = false;
      try { done = await switchInPlace(next.url, next.profileObj); } catch (_) { done = false; }
      if (!done) location.href = next.url;
    } else if (next.click) {
      next.click.click();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "goNext") return;
    if (pending) { sendResponse({ ok: false, reason: "busy" }); return; }
    const next = findNext();
    if (!next) { sendResponse({ ok: false, reason: "noNext" }); return; }

    sendResponse({ ok: true, profile: next.profile, url: next.url || null });

    const label = next.url ? decodeURIComponent(new URL(next.url).pathname.split("/").filter(Boolean).slice(-2).join(" · ")) : "über den Weiter-Knopf";
    if (!msg.countdown) { open(next); return; }
    pending = showToast(msg.countdown, label, () => open(next), () => send({ type: "cancelled" }));
  });

  // ---------- Nach dem Wechsel: Player starten, falls er erst geklickt werden muss ----------

  send({ type: "hello" }).then((r) => {
    if (!r || !r.autoplay) return;
    const selectors = profileFor(location.hostname).flatMap((p) => p.playSelectors || []);
    if (!selectors.length) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const hasPlayer = document.querySelector("video, iframe[src*='http']");
      if (hasPlayer || tries > 10) { clearInterval(timer); return; }
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); clearInterval(timer); return; }
      }
    }, 1000);
  });
})();
