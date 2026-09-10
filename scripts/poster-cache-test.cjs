'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prunePosters } = require('../electron/poster-cache.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'astria-poster-test-'));
  const now = Date.now();
  const day = 86400000;
  const folders = ['a', 'b', 'c'].map(char => path.join(root, char.repeat(64) + '-assets'));
  const posterName = 'playback-poster-123456abcdef.jpg';
  try {
    for (let i = 0; i < folders.length; i++) {
      await fs.mkdir(folders[i]);
      const poster = path.join(folders[i], posterName);
      await fs.writeFile(poster, Buffer.alloc(10));
      const date = new Date(now - (100 - i * 40) * day);
      await fs.utimes(poster, date, date);
      await fs.writeFile(path.join(folders[i], 'bookmark-test.jpg'), 'keep');
      await fs.writeFile(path.join(folders[i], 'annotation-1.jpg'), 'keep');
    }
    await fs.writeFile(path.join(root, 'workspace.json'), '{"playbackPosition":123}');
    const expired = await prunePosters(root, { now, maxBytes: 100, maxAgeMs: 90 * day });
    assert.equal(expired.removed, 1);
    await assert.rejects(fs.access(path.join(folders[0], posterName)));
    const limited = await prunePosters(root, {
      now, maxBytes: 10, maxAgeMs: 90 * day, protectedDirectory: dir => dir === folders[1]
    });
    assert.equal(limited.removed, 1);
    await fs.access(path.join(folders[1], posterName));
    await assert.rejects(fs.access(path.join(folders[2], posterName)));
    for (const folder of folders) {
      assert.equal(await fs.readFile(path.join(folder, 'bookmark-test.jpg'), 'utf8'), 'keep');
      assert.equal(await fs.readFile(path.join(folder, 'annotation-1.jpg'), 'utf8'), 'keep');
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'workspace.json'))).playbackPosition, 123);
    const lastPoster = path.join(folders[1], posterName);
    await fs.utimes(lastPoster, new Date(now), new Date(now));
    assert.equal((await prunePosters(root, { now, maxBytes: 100, maxAgeMs: day })).removed, 0);
    assert.equal((await prunePosters(root, { now, maxBytes: 0 })).removed, 1);
    assert.equal((await prunePosters(path.join(root, 'missing'))).removed, 0);
    // Exercise the actual store reader after eviction, including its fallback.
    const vm = require('node:vm');
    const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
    const context = vm.createContext({
      fs: require('node:fs'), fsp: fs, path, structuredClone, console, Buffer, process,
      createHash: require('node:crypto').createHash,
      ...require('node:url'), POSTER: require('../electron/poster-cache.cjs').POSTER,
      setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} })
    });
    vm.runInContext(source.slice(source.indexOf('class DesktopStore {'), source.indexOf('\nfunction findMediaArgument')) + '\nthis.Store = DesktopStore;', context);
    const store = new context.Store(path.join(root, 'app-data.json'));
    const key = 'video:test';
    await fs.mkdir(store.workspaceDirectory, { recursive: true });
    await fs.writeFile(store.launchStatePath(key), JSON.stringify({ key, state: {
      playbackPosition: 42, playbackPosterVersion: 'sdr-auto-1', playbackPoster: 'astria-thumb:' + posterName
    } }));
    const missing = await store.loadLaunchState(key);
    assert.equal(missing.playbackPoster, '');
    assert.equal(missing.playbackPosition, 42);
    await fs.mkdir(store.thumbnailDirectory(key));
    const restored = path.join(store.thumbnailDirectory(key), posterName);
    await fs.writeFile(restored, 'poster');
    await fs.utimes(restored, new Date(0), new Date(0));
    assert.match((await store.loadLaunchState(key)).playbackPoster, /^file:/);
    assert.ok((await fs.stat(restored)).mtimeMs >= now);
    const old = await store.resolveThumbnails(key, { playbackPoster: 'astria-thumb:' + posterName, playbackPosition: 42, bookmarks: [{ thumbnail: 'astria-thumb:bookmark-test.jpg' }] });
    assert.equal(old.playbackPoster, '');
    assert.equal(old.playbackPosition, 42);
    assert.match(old.bookmarks[0].thumbnail, /^file:/);
    const rejected = await store.externalizeThumbnails(key, { playbackPoster: 'data:image/jpeg;base64,b2xk' });
    assert.equal(rejected.workspace.playbackPoster, '');
    // A launch JSON write failure must retain the poster that the old JSON references.
    store.scheduleWrite = async target => !target.endsWith('-launch.json');
    assert.equal(await store.saveWorkspace(key, {
      bookmarks: [], annotationThumbnails: {}, playbackPosition: 43,
      playbackPosterVersion: 'sdr-auto-1', playbackPoster: 'data:image/jpeg;base64,bmV3'
    }), false);
    await fs.access(restored);
    // Once both snapshots commit, obsolete assets can be removed.
    store.scheduleWrite = async () => true;
    assert.equal(await store.saveWorkspace(key, {
      bookmarks: [], annotationThumbnails: {}, playbackPosition: 43,
      playbackPosterVersion: 'sdr-auto-1', playbackPoster: 'data:image/jpeg;base64,bmV3'
    }), true);
    await Promise.all([...store.workspaceSaves.values()].map(entry => entry.running));
    await assert.rejects(fs.access(restored));
    console.log('Poster cache tests passed: expiry, capacity, active protection, access refresh, review data preservation.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
