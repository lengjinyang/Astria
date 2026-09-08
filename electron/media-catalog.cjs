'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const formats = require('../media-formats.js');

// Only local drive paths are accepted. Neither UNC shares nor URL schemes reach mpv.
function localPath(value) {
  if (typeof value !== 'string' || value.includes('\0') || !/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) {
    throw new Error('仅支持本地媒体文件');
  }
  return path.normalize(value);
}

class MediaCatalog {
  constructor(cacheDirectory) { this.cacheDirectory = cacheDirectory; this.entries = new Map(); }
  async initialize() {
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    void this.cleanupStaleManifests();
  }
  async cleanupStaleManifests() {
    const now = Date.now();
    try {
      for (const name of await fs.readdir(this.cacheDirectory)) {
        if (!/^astria-sequence-[a-f0-9-]+\.txt$/.test(name)) continue;
        const target = path.join(this.cacheDirectory, name);
        if (now - (await fs.stat(target)).mtimeMs > 86400000) await fs.unlink(target).catch(() => {});
      }
    } catch { /* cache maintenance must not delay media opening */ }
  }
  async describe(value) {
    const resolved = await fs.realpath(localPath(value));
    localPath(resolved);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('媒体文件不存在');
    const name = path.basename(resolved), extension = path.extname(name).slice(1).toLowerCase();
    const descriptor = { path: resolved, url: pathToFileURL(resolved).href, name, displayName: name,
      size: stat.size, lastModified: stat.mtimeMs, mediaKind: 'video', sourceFrameOffset: 0,
      width: 0, height: 0, duration: 0, fps: 24, sourceFps: null, totalFrames: 0, missingFrameRanges: [], type: 'video/*' };
    let sequenceFiles = null;
    if (formats.image.includes(extension)) {
      const match = /^(.*?)(\d+)(\.[^.]+)$/.exec(name);
      const directory = path.dirname(resolved);
      const sequence = { directory: directory.toLowerCase(), prefix: (match?.[1] || path.parse(name).name).toLowerCase(),
        digits: match?.[2].length || 0, extension, single: !match };
      descriptor.mediaId = 'sequence:' + createHash('sha256').update(JSON.stringify(sequence)).digest('hex');
      const activeEntry = this.entries.get(descriptor.mediaId);
      if (activeEntry?.consumers.size) return activeEntry.descriptor;
      const numbered = new Map();
      if (match) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const candidate = /^(.*?)(\d+)(\.[^.]+)$/.exec(entry.name);
          if (candidate && candidate[1].toLowerCase() === match[1].toLowerCase() && candidate[2].length === sequence.digits && candidate[3].toLowerCase() === match[3].toLowerCase()) {
            const number = Number(candidate[2]);
            if (!Number.isSafeInteger(number)) throw new Error('序列帧编号超出范围');
            numbered.set(number, path.join(directory, entry.name));
          }
        }
      } else numbered.set(0, resolved);
      const numbers = [...numbered.keys()].sort((a,b) => a-b);
      const first = numbers[0], last = numbers.at(-1);
      if (last - first > 1000000) throw new Error('序列跨度超过 1,000,000 帧');
      for (let index = 1; index < numbers.length; index++) {
        const gapStart = numbers[index - 1] + 1, gapEnd = numbers[index] - 1;
        if (gapStart <= gapEnd) descriptor.missingFrameRanges.push([gapStart, gapEnd]);
      }
      for (const filePath of numbered.values()) {
        if (/[\r\n]/.test(filePath) || Buffer.byteLength(filePath, 'utf8') > 500) throw new Error('序列文件名过长或包含换行');
      }
      sequenceFiles = { first, last, numbered };
      const totalFrames = last - first + 1;
      Object.assign(descriptor, { mediaKind: 'sequence', sourceFps: 24, sourceFrameOffset: first, totalFrames,
        duration: totalFrames / 24, sequence, type: `image/${extension}` });
    } else {
      const identity = { path: resolved.toLowerCase(), size: stat.size, lastModified: stat.mtimeMs };
      descriptor.mediaId = 'video:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    }
    const previousEntry = this.entries.get(descriptor.mediaId);
    if (previousEntry?.consumers.size) return previousEntry.descriptor;
    if (previousEntry?.expiry) clearTimeout(previousEntry.expiry);
    if (previousEntry?.manifest) await fs.unlink(previousEntry.manifest).catch(() => {});
    const entry = { descriptor, sequenceFiles, manifest: null, manifestPromise: null, consumers: new Set(), expiry: null };
    entry.expiry = setTimeout(() => {
      if (this.entries.get(descriptor.mediaId) === entry && !entry.consumers.size) void this.release(descriptor.mediaId);
    }, 60000);
    entry.expiry.unref?.();
    this.entries.set(descriptor.mediaId, entry);
    return descriptor;
  }
  async source(id, fps = 24, consumerId = null) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('媒体授权已失效，请重新打开');
    if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('无效帧率');
    if (entry.expiry) { clearTimeout(entry.expiry); entry.expiry = null; }
    if (consumerId) entry.consumers.add(consumerId);
    if (!entry.sequenceFiles) return { source: entry.descriptor.path, descriptor: entry.descriptor };
    if (!entry.manifestPromise) entry.manifestPromise = this.writeManifest(entry);
    await entry.manifestPromise;
    return { source: `mf://@${entry.manifest}`, descriptor: { ...entry.descriptor, fps, duration: entry.descriptor.totalFrames / fps } };
  }
  async writeManifest(entry) {
    entry.manifest = path.join(this.cacheDirectory, `astria-sequence-${randomUUID()}.txt`);
    const handle = await fs.open(entry.manifest, 'w');
    try {
      const { first, last, numbered } = entry.sequenceFiles;
      let previous = numbered.get(first), lines = [];
      for (let frame = first; frame <= last; frame++) {
        if (numbered.has(frame)) previous = numbered.get(frame);
        lines.push(previous);
        if (lines.length >= 4096) { await handle.write(lines.join('\n') + '\n'); lines = []; }
      }
      if (lines.length) await handle.write(lines.join('\n') + '\n');
    } finally { await handle.close(); }
  }
  async release(id, consumerId) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (consumerId) entry.consumers.delete(consumerId);
    if (entry.consumers.size) return;
    if (entry.expiry) clearTimeout(entry.expiry);
    if (entry.manifestPromise) await entry.manifestPromise.catch(() => {});
    if (entry.consumers.size || this.entries.get(id) !== entry) return;
    if (entry.manifest) await fs.unlink(entry.manifest).catch(() => {});
    this.entries.delete(id);
  }
  async dispose() {
    for (const entry of this.entries.values()) if (entry.expiry) clearTimeout(entry.expiry);
    await Promise.all([...this.entries.values()].filter(e => e.manifest).map(e => fs.unlink(e.manifest).catch(() => {})));
    this.entries.clear();
  }
}
module.exports = { MediaCatalog, localPath };
