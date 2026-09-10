'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const POSTER = /^playback-poster-[a-f0-9]{12}\.(jpg|png|webp)$/;

// Only disposable playback posters are eligible. Review assets and JSON are never removed.
async function prunePosters(directory, { maxBytes = MAX_BYTES, maxAgeMs = MAX_AGE_MS,
  now = Date.now(), protectedDirectory = () => false } = {}) {
  const entries = [];
  for (const folder of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory() || !/^[a-f0-9]{64}-assets$/.test(folder.name)) continue;
    const parent = path.join(directory, folder.name);
    for (const file of await fsp.readdir(parent, { withFileTypes: true }).catch(() => [])) {
      if (!file.isFile() || !POSTER.test(file.name)) continue;
      const target = path.join(parent, file.name);
      const stat = await fsp.lstat(target).catch(() => null);
      if (stat?.isFile()) entries.push({ target, parent, size: stat.size, used: stat.mtimeMs });
    }
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  let removed = 0;
  for (const entry of entries.sort((a, b) => a.used - b.used)) {
    if (now - entry.used <= maxAgeMs && total <= maxBytes) continue;
    // The final check and unlink must not yield to a new save or media-open operation.
    if (protectedDirectory(entry.parent)) continue;
    try {
      const current = fs.lstatSync(entry.target);
      if (!current.isFile() || current.mtimeMs !== entry.used || current.size !== entry.size) continue;
      fs.unlinkSync(entry.target);
      total -= entry.size;
      removed++;
    } catch { /* A missing or busy cache file must not interrupt playback. */ }
  }
  return { removed, bytes: total };
}

module.exports = { prunePosters, MAX_BYTES, MAX_AGE_MS, POSTER };
