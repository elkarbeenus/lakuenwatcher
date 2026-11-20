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
    if (r && r.autoplay) { autoplayRequested = true; tryAutoplay(); }
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
      if (reported || !settings.enabled || !isEpisode(video)) return;
      reported = true;
      send({ type: "videoEnded", duration: video.duration });
    };

    video.addEventListener("loadedmetadata", resetIfNewSource);
    video.addEventListener("ended", report);
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

  function tryAutoplay() {
    if (!settings.autoplay) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const v = mainVideo();
      if ((v && !v.paused) || !autoplayRequested || tries > 30) {
        clearInterval(timer);
        return;
      }
      if (v) {
        v.play().catch(() => {
          // Brave blockiert Autoplay mit Ton → Play-Knopf des Players versuchen
          for (const sel of PLAY_SELECTORS) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) { el.click(); break; }
          }
        });
      } else {
        for (const sel of PLAY_SELECTORS) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) { el.click(); break; }
        }
      }
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
