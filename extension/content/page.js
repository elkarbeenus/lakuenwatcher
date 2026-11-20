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
      if (typeof r === "string") return { url: r, profile: profile.id };
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

  function open(next) {
    if (next.url) location.href = next.url;
    else if (next.click) next.click.click();
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
