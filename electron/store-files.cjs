'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function writeAtomic(target, payload, io = fs) {
  const temporary = `${target}.${process.pid}.tmp`;
  await io.mkdir(path.dirname(target), { recursive: true });
  try {
    await io.writeFile(temporary, payload, 'utf8');
    await io.rename(temporary, target);
  } finally {
    await io.unlink(temporary).catch(() => {});
  }
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function pruneStoreTemps(directory, { now = Date.now(), isAlive = processIsAlive } = {}) {
  let removed = 0;
  const locations = [
    [directory, /^app-data\.json\.([1-9]\d*)\.tmp$/],
    [path.join(directory, 'workspaces'), /^[a-f0-9]{64}(?:-launch)?\.json\.([1-9]\d*)\.tmp$/]
  ];
  for (const [parent, pattern] of locations) {
    const parentStat = await fs.lstat(parent).catch(() => null);
    if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) continue;
    for (const entry of await fs.readdir(parent, { withFileTypes: true }).catch(() => [])) {
      const match = pattern.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid > 0x7fffffff || pid === process.pid || isAlive(pid)) continue;
      const target = path.join(parent, entry.name);
      const stat = await fs.lstat(target).catch(() => null);
      if (!stat?.isFile() || now - stat.mtimeMs < 24 * 60 * 60 * 1000) continue;
      try { await fs.unlink(target); removed++; }
      catch { /* Locked or already removed: retry on the next maintenance pass. */ }
    }
  }
  return removed;
}

module.exports = { writeAtomic, pruneStoreTemps };
