// =============================================
//  asset-version.js — the build id every client asset URL carries
//
//  index.html loads 71 separate <script> tags plus the stylesheet, and until
//  2026-08-03 not one of them was versioned. express.static serves them with a
//  bare ETag, so a browser only picks up an edit when it decides to
//  revalidate — and a tab left open across a change never does. That is the
//  shape of the mount-price report: the Mount tab printing the pre-reprice
//  300k ladder while the server charged the current 60k is exactly what one
//  session running two different builds looks like, and there was no way to
//  tell from the outside which files a given browser actually had.
//
//  The version is DERIVED FROM THE SOURCE, never hand-bumped: the newest
//  mtime across js/ and css/, plus the file count so a deletion moves it too.
//  It therefore cannot drift from what is on disk, and nobody has to remember
//  anything. Same version in → same version out, so in production (where
//  mtimes are fixed at deploy) assets stay cacheable for a year.
//
//  Two consumers, both in server/index.js: the index.html route stamps every
//  local src/href with `?v=<version>`, and express.static hands anything that
//  arrives WITH a ?v= an immutable one-year Cache-Control.
// =============================================

import { readdirSync, statSync } from 'fs';
import { dirname, join }         from 'path';
import { fileURLToPath }         from 'url';

const _ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const _WATCHED = ['js', 'css'];

// Re-walking ~130 files on every page load is wasted work, and one second is
// far shorter than any edit-and-reload loop it has to keep up with.
const _TTL_MS = 1000;

// Fallback version if the scan ever comes back empty (unreadable directory,
// wrong working directory). Must be per-boot and unique: a constant here would
// pin a bogus version that clients then cache for a year.
const _BOOT_FALLBACK = `boot${Date.now().toString(36)}`;

let _cached   = null;
let _cachedAt = 0;

function _scan(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { _scan(full, acc); continue; }
    acc.count++;
    const mtime = statSync(full).mtimeMs;
    if (mtime > acc.newest) acc.newest = mtime;
  }
  return acc;
}

/** Current build id — a short, stable, source-derived string. */
export function getAssetVersion() {
  const now = Date.now();
  if (_cached && now - _cachedAt < _TTL_MS) return _cached;

  const acc = { newest: 0, count: 0 };
  for (const dir of _WATCHED) {
    try { _scan(join(_ROOT, dir), acc); }
    catch (e) { console.warn(`[asset-version] cannot read ${dir}/: ${e.message}`); }
  }

  // Base 36 keeps it short. The file count is appended so that deleting a file
  // moves the version even when it leaves the newest mtime untouched.
  _cached   = acc.count > 0 ? `${Math.floor(acc.newest).toString(36)}.${acc.count}` : _BOOT_FALLBACK;
  _cachedAt = now;
  return _cached;
}

// Local refs only. Absolute URLs (the Supabase CDN bundle, Google Fonts),
// protocol-relative URLs, data: URIs and in-page anchors are all left alone —
// we neither own their caching nor could invalidate it. `[^"?]+` skips
// anything that already carries a query string, so stamping is idempotent.
const _LOCAL_REF  = /\b(src|href)="(?!https?:|\/\/|data:|#)([^"?]+)"/g;
const _BUILD_META = /(<meta name="hexfront-build" content=")[^"]*(")/;

/**
 * Rewrite an HTML document's local asset URLs to carry `?v=<version>`, and
 * fill in the build meta tag so the running build is readable from the page
 * itself (view-source, or `document.querySelector` in the console) rather than
 * having to be inferred from behaviour.
 */
export function stampHtml(html, version) {
  return html
    .replace(_LOCAL_REF, (_match, attr, url) => `${attr}="${url}?v=${version}"`)
    .replace(_BUILD_META, `$1${version}$2`);
}
