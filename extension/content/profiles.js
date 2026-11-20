// LakuenWatcher – Seiten-Profile.
// Jedes Profil weiß, wie man auf einer Seite die nächste Folge findet.
// Neue Seite? Einfach hier ein Profil ergänzen.
//
// findNext(links, url) bekommt alle Links der Seite (absolute URLs) und die
// aktuelle URL und gibt die URL der nächsten Folge zurück – oder null, wenn
// es keine nächste Folge gibt (Serie zu Ende).
(() => {
  const cmp = (a, b) => (a.s - b.s) || (a.e - b.e);

  function nextFromEpisodeLinks(links, url, parse) {
    const cur = parse(url);
    if (!cur) return undefined;
    const later = [];
    let sameSeries = 0;
    for (const href of links) {
      const p = parse(href);
      if (!p || p.series !== cur.series) continue;
      sameSeries++;
      if (cmp(p, cur) > 0) later.push({ ...p, href });
    }
    later.sort(cmp);
    return { cur, later, sameSeries };
  }

  // ---------------- SerienStream (s.to) & AniWorld (gleiche Seitenstruktur) ----------------
  const sto = {
    id: "serienstream",
    name: "SerienStream / AniWorld",
    hosts: [/(^|\.)s\.to$/, /(^|\.)serienstream\.to$/, /(^|\.)serien\.sx$/, /(^|\.)aniworld\.to$/],
    parse(href) {
      try {
        const u = new URL(href);
        const m = u.pathname.match(/^\/(serie|anime)\/stream\/([^/]+)\/staffel-(\d+)\/episode-(\d+)\/?$/);
        if (!m) return null;
        return { series: `${u.host}/${m[1]}/${m[2]}`, type: m[1], slug: m[2], s: +m[3], e: +m[4], origin: u.origin };
      } catch (_) { return null; }
    },
    parseSeason(href) {
      try {
        const u = new URL(href);
        const m = u.pathname.match(/^\/(serie|anime)\/stream\/([^/]+)\/staffel-(\d+)\/?$/);
        return m ? { series: `${u.host}/${m[1]}/${m[2]}`, s: +m[3] } : null;
      } catch (_) { return null; }
    },
    findNext(links, url) {
      const r = nextFromEpisodeLinks(links, url, (h) => this.parse(h));
      if (!r) return undefined; // keine Folgenseite → Profil passt nicht
      const { cur, later, sameSeries } = r;

      // 1. nächste Folge in derselben Staffel
      const sameSeason = later.find((p) => p.s === cur.s);
      if (sameSeason) return sameSeason.href;

      // 2. nächste Staffel, Folge 1
      const seasons = links
        .map((h) => this.parseSeason(h))
        .filter((p) => p && p.series === cur.series && p.s > cur.s)
        .map((p) => p.s)
        .sort((a, b) => a - b);
      if (seasons.length) return `${cur.origin}/${cur.type}/stream/${cur.slug}/staffel-${seasons[0]}/episode-1`;
      if (later.length) return later[0].href;

      // 3. Seite hat gar keine Folgenliste gefunden (Layout geändert?) → einfach +1
      if (sameSeries <= 1) return `${cur.origin}/${cur.type}/stream/${cur.slug}/staffel-${cur.s}/episode-${cur.e + 1}`;

      return null; // Serie zu Ende
    },
    // Wenn der Player erst per Klick geladen wird
    playSelectors: [".inSiteWebStream .playButton", ".inSiteWebStream [class*='play' i]", ".hosterSiteVideo .watchEpisode"],
  };

  // ---------------- Filmpalast ----------------
  const filmpalast = {
    id: "filmpalast",
    name: "Filmpalast",
    hosts: [/(^|\.)filmpalast\.to$/],
    parse(href) {
      try {
        const u = new URL(href);
        const m = u.pathname.match(/^\/stream\/(.+?)-s(\d{1,3})e(\d{1,4})\/?$/i);
        if (!m) return null;
        return { series: `${u.host}/${m[1].toLowerCase()}`, s: +m[2], e: +m[3] };
      } catch (_) { return null; }
    },
    findNext(links, url) {
      const r = nextFromEpisodeLinks(links, url, (h) => this.parse(h));
      if (!r) return undefined;
      return r.later.length ? r.later[0].href : null;
    },
    playSelectors: [".play-button", "#play", "[class*='play' i]"],
  };

  // ---------------- Allgemein: Nummer in der URL hochzählen ----------------
  const generic = {
    id: "generic",
    name: "Allgemein",
    hosts: [/.*/],
    findNext(links, url) {
      const re = /(episode|folge|ep|e)([-_]?)(\d+)(?!.*(episode|folge|ep|e)[-_]?\d)/i;
      const m = url.match(re);
      if (!m) return undefined;
      const n = +m[3];
      const want = url.replace(re, (all, a, sep, num) => `${a}${sep}${String(n + 1).padStart(num.length, "0")}`);
      const wantNoPad = url.replace(re, (all, a, sep) => `${a}${sep}${n + 1}`);
      const strip = (h) => h.replace(/[#?].*$/, "").replace(/\/$/, "");
      const found = links.find((h) => strip(h) === strip(want) || strip(h) === strip(wantNoPad));
      return found || undefined;
    },
    playSelectors: [],
  };

  const PROFILES = [sto, filmpalast, generic];

  function profileFor(host) {
    return PROFILES.filter((p) => p.hosts.some((re) => re.test(host)));
  }

  globalThis.LW_PROFILES = { PROFILES, profileFor };
})();
