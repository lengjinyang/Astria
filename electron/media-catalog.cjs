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
    const now = Date.now();
    for (const name of await fs.readdir(this.cacheDirectory)) {
      if (!/^astria-sequence-[a-f0-9-]+\.txt$/.test(name)) continue;
      const target = path.join(this.cacheDirectory, name);
      if (now - (await fs.stat(target)).mtimeMs > 86400000) await fs.unlink(target).catch(() => {});
    }
  }
  async describe(value) {
    const resolved = await fs.realpath(localPath(value));
    localPath(resolved);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('媒体文件不存在');
    const name = path.basename(resolved), extension = path.extname(name).slice(1).toLowerCase();
    const descriptor = { path: resolved, url: pathToFileURL(resolved).href, name, displayName: name,
      size: stat.size, lastModified: stat.mtimeMs, mediaKind: 'video', sourceFrameOffset: 0,
      width: 0, height: 0, duration: 0, fps: 24, totalFrames: 0, missingFrames: [], type: 'video/*' };
    let files = null;
    if (formats.image.includes(extension)) {
      const match = /^(.*?)(\d+)(\.[^.]+)$/.exec(name);
      const directory = path.dirname(resolved);
      const sequence = { directory: directory.toLowerCase(), prefix: (match?.[1] || path.parse(name).name).toLowerCase(),
        digits: match?.[2].length || 0, extension, single: !match };
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
      files = []; let previous = numbered.get(first);
      for (let n = first; n <= last; n++) {
        if (numbered.has(n)) previous = numbered.get(n);
        else descriptor.missingFrames.push(n);
        if (/[\r\n]/.test(previous) || Buffer.byteLength(previous, 'utf8') > 500) throw new Error('序列文件名过长或包含换行');
        files.push(previous);
      }
      Object.assign(descriptor, { mediaKind: 'sequence', sourceFrameOffset: first, totalFrames: files.length,
        duration: files.length / 24, sequence, type: `image/${extension}` });
      descriptor.mediaId = 'sequence:' + createHash('sha256').update(JSON.stringify(sequence)).digest('hex');
    } else {
      const identity = { path: resolved.toLowerCase(), size: stat.size, lastModified: stat.mtimeMs };
      descriptor.mediaId = 'video:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    }
    const previousEntry = this.entries.get(descriptor.mediaId);
    if (previousEntry?.manifest) await fs.unlink(previousEntry.manifest).catch(() => {});
    this.entries.set(descriptor.mediaId, { descriptor, files, manifest: null });
    return descriptor;
  }
  async source(id, fps = 24) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('媒体授权已失效，请重新打开');
    if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('无效帧率');
    if (!entry.files) return { source: entry.descriptor.path, descriptor: entry.descriptor };
    if (!entry.manifest) {
      entry.manifest = path.join(this.cacheDirectory, `astria-sequence-${randomUUID()}.txt`);
      await fs.writeFile(entry.manifest, entry.files.join('\n') + '\n', 'utf8');
    }
    return { source: `mf://@${entry.manifest}`, descriptor: { ...entry.descriptor, fps, duration: entry.files.length / fps } };
  }
  async dispose() {
    await Promise.all([...this.entries.values()].filter(e => e.manifest).map(e => fs.unlink(e.manifest).catch(() => {})));
    this.entries.clear();
  }
}
module.exports = { MediaCatalog, localPath };
