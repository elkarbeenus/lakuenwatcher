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
  const seen = new WeakSet();

  // Erweiterung neu geladen (z. B. nach Update)? Dann ist dieser alte Content-Script
  // tot und darf nichts mehr senden.
  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  const send = (msg) => alive() ? chrome.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null);

  chrome.storage.local.get(Object.keys(DEFAULTS)).then((s) => { settings = { ...DEFAULTS, ...s }; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [k, v] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = v.newValue ?? DEFAULTS[k];
  });

  send({ type: "hello" }).then((r) => {
    if (r && r.castMode) setCastMode(true, { keepPlaying: !!r.autoplay });
    if (r && r.autoplay) { autoplayRequested = true; tryAutoplay(); }
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "castMode") setCastMode(!!msg.on);
  });

  const isEpisode = (v) => Number.isFinite(v.duration) && v.duration >= MIN_EPISODE_SECONDS;

  function attach(video) {
    if (seen.has(video)) return;
    seen.add(video);
    let reported = false;
    let introDone = false;
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
    video.addEventListener("play", () => {
      // Läuft auf dem Fernseher → hier nicht weiterspielen
      if (castMode && !autoplayRequested && isEpisode(video)) { video.muted = true; video.pause(); }
    });
    video.addEventListener("timeupdate", () => {
      if (!isEpisode(video)) return;
      const remaining = video.duration - video.currentTime;
      if (settings.outroSkip > 0 && remaining <= settings.outroSkip && remaining > 0.5 && !video.paused) report();
      if (remaining > settings.outroSkip + 5) reported = false; // zurückgespult
    });
    video.addEventListener("playing", () => {
      if (!isEpisode(video)) return;
      if (autoplayRequested) { autoplayRequested = false; send({ type: "playing" }); }
      if (!introDone) {
        introDone = true;
        if (settings.introSkip > 0 && video.currentTime < settings.introSkip && video.duration > settings.introSkip + 60) {
          video.currentTime = settings.introSkip;
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
