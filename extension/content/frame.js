// LakuenWatcher – läuft in JEDEM Frame (auch im Player-iframe des Hosters).
// Aufgaben: Ende einer Folge erkennen, neue Folge automatisch starten,
// Intro/Abspann überspringen.
(() => {
  if (window.__lakuenWatcherFrame) return;
  window.__lakuenWatcherFrame = true;

  const MIN_EPISODE_SECONDS = 180; // kürzere Videos (Werbung, Trailer) ignorieren

  const DEFAULTS = { enabled: true, outroSkip: 0, introSkip: 0, autoplay: true };
  let settings = { ...DEFAULTS };
  let autoplayRequested = false;
  let castMode = false;
  let castTimer = null;
  let eff = { introSkip: 0, outroSkip: 0, keys: true }; // Werte für diese Serie
  let resumeAt = 0;
  const seen = new WeakSet();

  // Erweiterung neu geladen (z. B. nach Update)? Dann ist dieser alte Content-Script
  // tot und darf nichts mehr senden.
  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  const send = (msg) => alive() ? chrome.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null);

  chrome.storage.local.get(Object.keys(DEFAULTS)).then((s) => { settings = { ...DEFAULTS, ...s }; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [k, v] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = v.newValue ?? DEFAULTS[k];
    if (changes.series || changes.introSkip || changes.outroSkip || changes.keys) {
      send({ type: "effective" }).then((r) => { if (r) eff = { ...eff, ...r }; });
    }
  });

  send({ type: "hello" }).then((r) => {
    if (!r) return;
    eff = { introSkip: r.introSkip || 0, outroSkip: r.outroSkip || 0, keys: r.keys !== false };
    resumeAt = r.resumeAt || 0;
    if (r.castMode) setCastMode(true, { keepPlaying: !!r.autoplay });
    if (r.autoplay) { autoplayRequested = true; tryAutoplay(); watchForDeadPlayer(); }
  });

  // ---------- Fernseher-Modus (LakuenCast) ----------
  // Das Video läuft auf dem Chromecast: hier stumm und pausiert lassen.
  function setCastMode(on, { keepPlaying = false } = {}) {
    castMode = on;
    clearInterval(castTimer);
    if (!on) return;
    if (!keepPlaying) holdLocalVideo();
    // Nur der oberste Frame hält den Hintergrund wach und fragt LakuenCast ab
    if (window.top === window) castTimer = setInterval(() => send({ type: "castTick" }), 5000);
  }

  function holdLocalVideo() {
    document.querySelectorAll("video").forEach((v) => {
      v.muted = true;
      if (!v.paused) v.pause();
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "castMode") setCastMode(!!msg.on);
    if (msg.type === "skipIntro") skipIntro(msg.introSkip);
    if (msg.type === "getTime") {
      // Nur der Frame mit der Folge antwortet
      const v = mainVideo();
      if (v && isEpisode(v)) { sendResponse({ time: v.currentTime, duration: v.duration }); return; }
    }
    if (msg.type === "resumeLocal") {
      // Vom Fernseher zurück in den Browser: an derselben Stelle weiter
      const v = mainVideo();
      if (!v || !isEpisode(v)) return;
      setCastMode(false);
      v.currentTime = Math.min(msg.time, v.duration - 5);
      v.muted = false;
      v.play().catch(() => { v.muted = true; v.play().then(() => offerUnmute(v)).catch(() => {}); });
      toast(`▶ Weiter im Browser bei ${fmt(msg.time)}`);
    }
  });

  // ---------- Intro überspringen, Tasten ----------
  function skipIntro(introSkip) {
    const v = mainVideo();
    if (!v || !isEpisode(v)) return;
    const target = introSkip > 0 && v.currentTime < introSkip ? introSkip : v.currentTime + 85;
    v.currentTime = Math.min(target, v.duration - 5);
    toast(`⏭ Übersprungen bis ${fmt(v.currentTime)}`);
  }

  document.addEventListener("keydown", (e) => {
    if (!eff.keys || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    const key = e.key.toLowerCase();
    if (key === "n") { e.preventDefault(); e.stopPropagation(); send({ type: "keyNext" }); }
    else if (key === "s" && mainVideo()) { e.preventDefault(); e.stopPropagation(); skipIntro(eff.introSkip); }
  }, true);

  // ---------- Hinweis-Einblendung (im Player) ----------
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
  };

  function toast(text, action) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .b{font:600 14px system-ui,sans-serif;color:#fff;background:rgba(22,20,31,.92);border:1px solid #7c5cff;
         border-radius:10px;padding:8px 12px;display:flex;gap:10px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.5)}
      button{font:inherit;color:#fff;background:#2a2638;border:0;border-radius:7px;padding:4px 9px;cursor:pointer}</style>
      <div class="b"><span></span></div>`;
    root.querySelector("span").textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => { action.run(); host.remove(); };
      root.querySelector(".b").appendChild(b);
    }
    (document.body || document.documentElement).appendChild(host);
    setTimeout(() => host.remove(), action ? 7000 : 2500);
  }

  // ---------- Toter Hoster ----------
  // Nur der große Player-Rahmen meldet: "hier kommt kein Video" → anderer Hoster
  function watchForDeadPlayer() {
    if (window.top === window || window.innerWidth * window.innerHeight < 150000) return;
    setTimeout(() => {
      const ok = Array.from(document.querySelectorAll("video")).some((v) => Number.isFinite(v.duration) && v.duration > 0);
      if (!ok && !castMode) send({ type: "playerFailed" });
    }, 25000);
  }

  const isEpisode = (v) => Number.isFinite(v.duration) && v.duration >= MIN_EPISODE_SECONDS;

  function attach(video) {
    if (seen.has(video)) return;
    seen.add(video);
    let reported = false;
    let introDone = false;
    let lastProgress = 0;
    let lastSrc = video.currentSrc;

    const resetIfNewSource = () => {
      if (video.currentSrc !== lastSrc) { lastSrc = video.currentSrc; reported = false; introDone = false; }
    };

    const report = () => {
      if (castMode || reported || !settings.enabled || !isEpisode(video)) return;
      reported = true;
      send({ type: "videoEnded", duration: video.duration });
    };

    video.addEventListener("loadedmetadata", () => {
      resetIfNewSource();
      // Direkte Video-Adresse (kein blob:) für "An Fernseher senden" merken
      const src = video.currentSrc;
      if (/^https?:/.test(src) && isEpisode(video)) send({ type: "videoSrc", url: src, referer: location.href });
    });
    video.addEventListener("ended", report);
    video.addEventListener("pause", () => {
      if (!castMode && isEpisode(video) && video.currentTime > 5) send({ type: "progress", time: video.currentTime, duration: video.duration });
    });
    video.addEventListener("play", () => {
      // Läuft auf dem Fernseher → hier nicht weiterspielen
      if (castMode && !autoplayRequested && isEpisode(video)) { video.muted = true; video.pause(); }
    });
    video.addEventListener("timeupdate", () => {
      if (!isEpisode(video)) return;
      const remaining = video.duration - video.currentTime;
      if (eff.outroSkip > 0 && remaining <= eff.outroSkip && remaining > 0.5 && !video.paused) report();
      if (remaining > eff.outroSkip + 5) reported = false; // zurückgespult
      // Stand fürs Weiterschauen merken (alle 10 s)
      if (!castMode && !video.paused && Date.now() - lastProgress > 10000) {
        lastProgress = Date.now();
        send({ type: "progress", time: video.currentTime, duration: video.duration });
      }
    });
    video.addEventListener("playing", () => {
      if (!isEpisode(video)) return;
      if (autoplayRequested) { autoplayRequested = false; send({ type: "playing" }); }
      if (!introDone) {
        introDone = true;
        if (resumeAt > 0 && video.currentTime < 10 && resumeAt < video.duration - 60) {
          // An der letzten Stelle weiterschauen
          const from = resumeAt;
          resumeAt = 0;
          video.currentTime = from;
          toast(`▶ Weiter bei ${fmt(from)}`, { label: "Von vorne", run: () => { video.currentTime = 0; } });
        } else if (eff.introSkip > 0 && video.currentTime < eff.introSkip && video.duration > eff.introSkip + 60) {
          video.currentTime = eff.introSkip;
        }
      }
    });
  }

  function scan() {
    document.querySelectorAll("video").forEach(attach);
  }

  // ---------- Autoplay der neuen Folge ----------

  const PLAY_SELECTORS = [
    ".vjs-big-play-button",
    ".plyr__control--overlaid",
    ".jw-icon-display",
    ".jw-display-icon-container",
    ".fp-play",
    ".play-button",
    ".playbutton",
    "button[aria-label*='play' i]",
    "button[title*='play' i]",
    "[class*='big-play' i]",
  ];

  function mainVideo() {
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("video").forEach((v) => {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = v; bestArea = area; }
    });
    return best;
  }

  // Klick irgendwo im Player = echte Nutzer-Aktion → Ton darf wieder an
  let unmuteTarget = null;
  function offerUnmute(video) {
    if (castMode || unmuteTarget) return;
    unmuteTarget = video;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:16px;top:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      button{font:600 15px system-ui,sans-serif;color:#fff;background:#7c5cff;border:0;border-radius:10px;
             padding:10px 16px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.5)}
      button:hover{background:#9b83ff}</style>
      <button>🔊 Ton an</button>`;
    const unmute = () => {
      if (unmuteTarget) { unmuteTarget.muted = false; if (unmuteTarget.paused) unmuteTarget.play().catch(() => {}); }
      unmuteTarget = null;
      host.remove();
      document.removeEventListener("pointerdown", unmute, true);
      document.removeEventListener("keydown", unmute, true);
    };
    root.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); unmute(); });
    document.addEventListener("pointerdown", unmute, true);
    document.addEventListener("keydown", unmute, true);
    (document.body || document.documentElement).appendChild(host);
  }

  function clickPlayButton() {
    for (const sel of PLAY_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { el.click(); return true; }
    }
    return false;
  }

  function tryAutoplay() {
    if (!settings.autoplay && !castMode) return;
    let tries = 0;
    let mutedFallback = false;
    const timer = setInterval(async () => {
      tries++;
      const v = mainVideo();
      if ((v && !v.paused) || !autoplayRequested || tries > 30) {
        clearInterval(timer);
        return;
      }
      if (!v) { clickPlayButton(); return; }
      if (castMode) v.muted = true; // stumm darf immer automatisch starten
      try {
        await v.play();
      } catch (e) {
        if (e && e.name === "NotAllowedError" && !v.muted) {
          // Brave blockt den Start mit Ton → stumm starten und "Ton an" anbieten
          v.muted = true;
          mutedFallback = true;
          try { await v.play(); } catch (_) { clickPlayButton(); }
        } else {
          clickPlayButton();
        }
      }
      if (!v.paused && mutedFallback) offerUnmute(v);
    }, 1000);
  }

  scan();
  let scanQueued = false;
  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scan(); }, 300);
  };
  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 2000);
})();
