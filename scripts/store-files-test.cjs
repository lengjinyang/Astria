'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeAtomic, pruneStoreTemps } = require('../electron/store-files.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'astria-store-test-'));
  try {
    const target = path.join(root, 'app-data.json');
    await writeAtomic(target, 'original');
    const temporary = `${target}.${process.pid}.tmp`;
    await assert.rejects(writeAtomic(target, 'replacement', {
      ...fs, rename: async () => { throw new Error('rename failed'); }
    }), /rename failed/);
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    await assert.rejects(fs.access(temporary));
    await assert.rejects(writeAtomic(target, 'replacement', {
      ...fs, writeFile: async (...args) => { await fs.writeFile(...args); throw new Error('write failed'); }
    }), /write failed/);
    await assert.rejects(fs.access(temporary));
    await writeAtomic(target, 'saved');
    assert.equal(await fs.readFile(target, 'utf8'), 'saved');
    await fs.mkdir(path.join(root, 'workspaces'));
    const dead = [101, 102, 103].filter(pid => pid !== process.pid);
    const stale = [
      `app-data.json.${dead[0]}.tmp`,
      `workspaces/${'a'.repeat(64)}.json.${dead[0]}.tmp`,
      `workspaces/${'b'.repeat(64)}-launch.json.${dead[0]}.tmp`
    ];
    const retained = [`app-data.json.${process.pid}.tmp`, `app-data.json.${dead[1]}.tmp`, 'other.tmp'];
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const name of [...stale, ...retained]) {
      await fs.writeFile(path.join(root, name), 'keep or expire');
      await fs.utimes(path.join(root, name), old, old);
    }
    const fresh = `app-data.json.${dead[2] || 104}.tmp`;
    await fs.writeFile(path.join(root, fresh), 'fresh');
    assert.equal(await pruneStoreTemps(root, { isAlive: pid => pid === dead[1] }), 3);
    for (const name of stale) await assert.rejects(fs.access(path.join(root, name)));
    for (const name of [...retained, fresh]) await fs.access(path.join(root, name));
    assert.equal(await fs.readFile(target, 'utf8'), 'saved');
    console.log('Store file tests passed: failed write cleanup, atomic replacement, stale cleanup, active/current process and fresh file protection.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
