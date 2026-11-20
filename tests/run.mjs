// Tests ohne Abhängigkeiten:  node tests/run.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { compareVersions, isNewer, displayVersion } from "../extension/lib/version.js";
import { seriesInfo, episodeLabel } from "../extension/lib/series.js";

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   ", name); }
  catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}

// ---------- Update-Entscheidung ----------
test("älter → Update", () => assert.equal(isNewer("v0.2.0", "0.1.0"), true));
test("gleich → kein Update", () => assert.equal(isNewer("v0.1.0", "0.1.0"), false));
test("neuer installiert → kein Update", () => assert.equal(isNewer("v0.1.0", "0.2.0"), false));
test("Testbuild über Release → Update", () => assert.equal(isNewer("v0.2.0-test.1", "0.1.0"), true));
test("Release über eigenen Testbuild → Update", () => assert.equal(isNewer("v0.2.0", "0.2.0-test.3"), true));
test("Testbuild 4 über Testbuild 3 → Update", () => assert.equal(isNewer("v0.2.0-test.4", "0.2.0-test.3"), true));
test("Testbuild unter eigenem Release → kein Update", () => assert.equal(isNewer("v0.2.0-test.9", "0.2.0"), false));
test("10 > 9", () => assert.equal(compareVersions("0.10.0", "0.9.0"), 1));
test("Anzeige", () => {
  assert.equal(displayVersion("0.2.0-test.3"), "v0.2.0 test 3");
  assert.equal(displayVersion("v1.0.0"), "v1.0.0");
});

// ---------- Seiten-Profile ----------
const ctx = { URL, console };
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../extension/content/profiles.js", import.meta.url), "utf8"), ctx);
const { profileFor } = ctx.LW_PROFILES;
function next(url, links) {
  const host = new URL(url).hostname;
  for (const p of profileFor(host)) {
    const r = p.findNext(links, url);
    if (r !== undefined) return r;
  }
  return undefined;
}

const S = "https://s.to/serie/stream/breaking-bad";
const seasonLinks = [`${S}/staffel-1`, `${S}/staffel-2`, `${S}/staffel-3`];
const eps = (s, n) => Array.from({ length: n }, (_, i) => `${S}/staffel-${s}/episode-${i + 1}`);

test("s.to: nächste Folge in der Staffel", () =>
  assert.equal(next(`${S}/staffel-1/episode-3`, [...seasonLinks, ...eps(1, 7)]), `${S}/staffel-1/episode-4`));
test("s.to: Staffelende → nächste Staffel Folge 1", () =>
  assert.equal(next(`${S}/staffel-1/episode-7`, [...seasonLinks, ...eps(1, 7)]), `${S}/staffel-2/episode-1`));
test("s.to: letzte Folge der Serie → null", () =>
  assert.equal(next(`${S}/staffel-3/episode-7`, [...seasonLinks, ...eps(3, 7)]), null));
test("s.to: Folgenliste fehlt → +1", () =>
  assert.equal(next(`${S}/staffel-2/episode-5`, []), `${S}/staffel-2/episode-6`));
test("s.to: andere Serien-Links ignorieren", () =>
  assert.equal(next(`${S}/staffel-1/episode-7`, [...seasonLinks, ...eps(1, 7), "https://s.to/serie/stream/dark/staffel-1/episode-8"]), `${S}/staffel-2/episode-1`));
test("aniworld: gleiches Schema", () =>
  assert.equal(next("https://aniworld.to/anime/stream/one-piece/staffel-1/episode-1",
    ["https://aniworld.to/anime/stream/one-piece/staffel-1/episode-2"]), "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-2"));
test("s.to: Seriencover-Seite ist keine Folge → undefined", () =>
  assert.equal(next(`${S}`, seasonLinks), undefined));

const F = "https://filmpalast.to/stream";
test("filmpalast: nächste Folge", () =>
  assert.equal(next(`${F}/the-office-s01e02`, [`${F}/the-office-s01e01`, `${F}/the-office-s01e03`, `${F}/the-office-s02e01`]), `${F}/the-office-s01e03`));
test("filmpalast: Staffelwechsel", () =>
  assert.equal(next(`${F}/the-office-s01e06`, [`${F}/the-office-s01e05`, `${F}/the-office-s02e01`]), `${F}/the-office-s02e01`));
test("filmpalast: Ende → null", () =>
  assert.equal(next(`${F}/the-office-s09e23`, [`${F}/the-office-s09e22`]), null));

test("allgemein: Folgennummer in der URL", () =>
  assert.equal(next("https://example.com/show/folge-09", ["https://example.com/show/folge-10"]), "https://example.com/show/folge-10"));
test("allgemein: ohne passenden Link → undefined", () =>
  assert.equal(next("https://example.com/show/folge-9", ["https://example.com/"]), undefined));

// ---------- Serien erkennen ----------
test("Serie s.to", () => {
  const i = seriesInfo("https://s.to/serie/stream/3-body-problem/staffel-1/episode-4");
  assert.equal(i.key, "s.to/3-body-problem");
  assert.equal(i.name, "3 Body Problem");
  assert.equal(episodeLabel(i), "S1 · E4");
});
test("Serie Filmpalast", () => {
  const i = seriesInfo("https://filmpalast.to/stream/the-office-s02e05");
  assert.equal(i.key, "filmpalast.to/the-office");
  assert.equal(i.season, 2);
  assert.equal(i.episode, 5);
});
test("Serie gleiche Serie andere Folge = gleicher Schlüssel", () =>
  assert.equal(seriesInfo("https://example.com/show/folge-3").key, seriesInfo("https://example.com/show/folge-4").key));
test("keine Serie", () => assert.equal(seriesInfo("https://example.com/about"), null));

// ---------- Hoster-Reihenfolge ----------
const hctx = { URL, console };
hctx.globalThis = hctx;
vm.runInNewContext(readFileSync(new URL("../extension/content/hosters.js", import.meta.url), "utf8"), hctx);
test("Hoster: Deutsch vor Englisch, dann Reihenfolge", () => {
  const c = [{ name: "VOE", lang: "en" }, { name: "Doodstream", lang: "de" }, { name: "VOE", lang: "de" }];
  const r = hctx.LW_HOSTERS.rank(c, "de", "VOE, Doodstream");
  assert.deepEqual(r.map((x) => `${x.name}/${x.lang}`), ["VOE/de", "Doodstream/de", "VOE/en"]);
});
test("Hoster: Englisch gewünscht", () => {
  const c = [{ name: "VOE", lang: "de" }, { name: "Doodstream", lang: "en" }];
  assert.equal(hctx.LW_HOSTERS.rank(c, "en", "VOE")[0].lang, "en");
});

if (failed) { console.log(`\n${failed} Test(s) fehlgeschlagen`); process.exit(1); }
console.log("\nAlle Tests ok");
