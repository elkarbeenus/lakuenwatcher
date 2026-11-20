// LakuenWatcher – Hoster-Auswahl (Lieblings-Hoster und Sprache).
// Findet auf Folgenseiten die Hoster-Einträge (z. B. VOE, Doodstream) samt Sprache
// und sortiert sie nach den Einstellungen.
(() => {
  const KNOWN = ["VOE", "Doodstream", "Vidoza", "Filemoon", "Streamtape", "Vidmoly", "SpeedFiles", "LoadX",
                 "Luluvdo", "Vidguard", "Mixdrop", "Upstream", "Supervideo", "Dropload"];
  const KNOWN_RE = new RegExp(`\\b(${KNOWN.join("|")})\\b`, "i");

  function langFromText(t) {
    t = (t || "").toLowerCase();
    if (/(untertitel|subbed|sub\b|ger-sub|deutsche untertitel|japanese-german)/.test(t)) return "en-sub";
    if (/(german|deutsch|\bde\b|flag-de|\/de\.)/.test(t)) return "de";
    if (/(english|englisch|\ben\b|flag-en|\/en\.|\/us\.|\/gb\.)/.test(t)) return "en";
    return null;
  }

  function detectLang(el) {
    const S_TO_KEYS = { 1: "de", 2: "en", 3: "en-sub" };
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      const key = n.getAttribute && n.getAttribute("data-lang-key");
      if (key && S_TO_KEYS[key]) return S_TO_KEYS[key];
      if (n.querySelectorAll) {
        for (const img of n.querySelectorAll("img, svg, [class*='flag']")) {
          const l = langFromText([img.getAttribute("alt"), img.getAttribute("title"), img.getAttribute("src"),
                                  img.getAttribute("class"), img.getAttribute("data-lang")].join(" "));
          if (l) return l;
        }
      }
    }
    // Überschrift davor ("Deutsch", "Englisch")
    for (let n = el; n; n = n.parentElement) {
      let p = n.previousElementSibling;
      for (let i = 0; p && i < 6; p = p.previousElementSibling, i++) {
        if (/^(H\d|DIV|SPAN|P|STRONG|B)$/.test(p.tagName) && p.textContent.trim().length < 40) {
          const l = langFromText(p.textContent);
          if (l) return l;
        }
      }
      if (n.tagName === "BODY") break;
    }
    return null;
  }

  function linkOf(el) {
    const t = el.getAttribute("data-link-target") || el.getAttribute("data-src") ||
              (el.tagName === "A" && /\/redirect\//.test(el.getAttribute("href") || "") ? el.getAttribute("href") : null);
    if (t) return t;
    const inner = el.querySelector && el.querySelector("[data-link-target], a[href*='/redirect/']");
    return inner ? inner.getAttribute("data-link-target") || inner.getAttribute("href") : null;
  }

  function candidates(doc, baseUrl) {
    const seen = new Set();
    const out = [];
    for (const el of doc.querySelectorAll("[data-link-target], a[href*='/redirect/']")) {
      const card = el.closest("li") || el;
      const raw = linkOf(card) || linkOf(el);
      if (!raw) continue;
      let link;
      try { link = new URL(raw, baseUrl).href; } catch (_) { continue; }
      if (seen.has(link)) continue;
      seen.add(link);
      const text = card.textContent.replace(/\s+/g, " ").trim();
      const m = text.match(KNOWN_RE);
      out.push({
        el: card,
        clickEl: el,
        link,
        name: m ? m[1] : text.split(" ")[0] || "?",
        lang: detectLang(card),
        active: /active|selected|current/i.test(`${card.className} ${el.className}`),
      });
    }
    return out;
  }

  const LANG_ORDER = {
    de: ["de", "en-sub", "en", null],
    "en-sub": ["en-sub", "de", "en", null],
    en: ["en", "en-sub", "de", null],
    any: [],
  };

  function rank(cands, language, hosterOrder) {
    const langs = LANG_ORDER[language] || LANG_ORDER.de;
    const hosters = String(hosterOrder || "").split(/[,;]/).map((h) => h.trim().toLowerCase()).filter(Boolean);
    const score = (c) => {
      const li = langs.length ? langs.indexOf(c.lang) : 0;
      const hi = hosters.indexOf(c.name.toLowerCase());
      return (li < 0 ? 9 : li) * 100 + (hi < 0 ? 50 : hi);
    };
    return cands.slice().sort((a, b) => score(a) - score(b));
  }

  globalThis.LW_HOSTERS = { candidates, rank, detectLang, KNOWN };
})();
