const fs = require('node:fs/promises');
const path = require('node:path');
const extensions = new Set(require('../media-formats.js').video);

async function readDirectory(directory) {
  if (directory === '') {
    const drives = await Promise.all('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async letter => {
      const root = `${letter}:\\`;
      try { await fs.access(root); return { name: root, path: root, directory: true }; } catch { return null; }
    }));
    return { path: '', parent: null, entries: drives.filter(Boolean) };
  }
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw new Error('请输入完整文件夹路径');
  const resolved = path.resolve(directory);
  const items = await fs.readdir(resolved, { withFileTypes: true });
  const entries = items.filter(item => item.isDirectory() || (item.isFile() && extensions.has(path.extname(item.name).slice(1).toLowerCase())))
    .map(item => ({ name: item.name, path: path.join(resolved, item.name), directory: item.isDirectory() }));
  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? '' : parent, entries };
}
module.exports = { readDirectory };
