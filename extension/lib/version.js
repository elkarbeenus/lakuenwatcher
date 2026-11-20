// Versions-Logik für den Update-Check. Wird von background.js, popup.js
// und den Tests (tests/version.test.mjs) gemeinsam benutzt.
//
// Tags im Repo: v0.1.0, v0.2.0, ... Testbuilds: v0.2.0-test.3
// Anzeige für den Nutzer: "v0.2.0" bzw. "v0.2.0 test 3".

export function parseVersion(text) {
  const m = String(text || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-.]?test[.-]?(\d+))?/i);
  if (!m) return null;
  return {
    major: +m[1],
    minor: +m[2],
    patch: +m[3],
    // Release ohne Test gilt als neuer als jeder Testbuild derselben Version.
    test: m[4] === undefined ? Infinity : +m[4],
  };
}

// <0: a älter als b, 0: gleich, >0: a neuer als b
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (const key of ["major", "minor", "patch", "test"]) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  return 0;
}

export function isNewer(remote, installed) {
  return compareVersions(remote, installed) > 0;
}

export function displayVersion(text) {
  const v = parseVersion(text);
  if (!v) return String(text || "?");
  const base = `v${v.major}.${v.minor}.${v.patch}`;
  return v.test === Infinity ? base : `${base} test ${v.test}`;
}
