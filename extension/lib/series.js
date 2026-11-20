// Aus einer Folgen-URL die Serie, Staffel und Folge ablesen.
// Wird für "Weiterschauen" und "Einstellungen pro Serie" gebraucht.

const titleCase = (slug) =>
  decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function seriesInfo(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  const host = u.hostname.replace(/^www\./, "");

  // SerienStream / AniWorld: /serie/stream/<slug>/staffel-S/episode-E
  let m = u.pathname.match(/^\/(serie|anime)\/stream\/([^/]+)(?:\/staffel-(\d+)(?:\/episode-(\d+))?)?/);
  if (m) {
    return {
      key: `${host}/${m[2]}`,
      name: titleCase(m[2]),
      season: m[3] ? +m[3] : null,
      episode: m[4] ? +m[4] : null,
    };
  }

  // Filmpalast: /stream/<slug>-sXXeYY
  m = u.pathname.match(/^\/stream\/(.+?)-s(\d{1,3})e(\d{1,4})\/?$/i);
  if (m) {
    return { key: `${host}/${m[1].toLowerCase()}`, name: titleCase(m[1]), season: +m[2], episode: +m[3] };
  }

  // Allgemein: Folgennummer aus dem Pfad entfernen
  m = u.pathname.match(/^(.*?)(?:episode|folge|ep)[-_]?(\d+)(.*)$/i);
  if (m) {
    const base = (m[1] + m[3]).replace(/\/+$/, "");
    const slug = base.split("/").filter(Boolean).pop() || host;
    return { key: `${host}${base}`, name: titleCase(slug), season: null, episode: +m[2] };
  }
  return null;
}

export function episodeLabel(info) {
  if (!info) return "";
  const parts = [];
  if (info.season != null) parts.push(`S${info.season}`);
  if (info.episode != null) parts.push(`E${info.episode}`);
  return parts.join(" · ");
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
}
