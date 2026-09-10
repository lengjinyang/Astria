'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(require.resolve('../electron/media-service.cjs'), 'utf8');
async function run() {
  const handlers = new Map(); let created = 0; let fail = false;
  const pending = [];
  class FakeSession {
    constructor(_core, owner) {
      this.id = String(++created); this.owner = owner;
      this.ready = new Promise((resolve, reject) => pending.push(() => fail ? reject(Error('init failed')) : resolve()));
    }
    async destroy() { this.closed = true; await this.ready.catch(() => {}); }
  }
  const context = { Session: FakeSession, loadCore: () => ({}), startupTrace: { mark() {} }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('class MediaService'), source.indexOf('\nclass Session')) + '\nthis.MediaService = MediaService;', context);
  const owner = new EventEmitter(); owner.isDestroyed = () => false; owner.mainFrame = {};
  const service = new context.MediaService({}, {}, () => ({ webContents: owner }));
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const create = () => handlers.get('media:create')(event);
  service.prepare(owner); service.prepare(owner);
  assert.equal(created, 1);
  const first = create(); pending.shift()(); assert.equal(await first, '1');
  const second = create(); pending.shift()(); assert.equal(await second, '2');
  assert.equal(service.sessions.size, 2);
  for (let i = 0; i < 2; i++) { const extra = create(); pending.shift()(); await extra; }
  await assert.rejects(create(), /数量已达上限/);
  const stranger = new EventEmitter(); stranger.mainFrame = {};
  assert.throws(() => handlers.get('media:create')({ sender: stranger, senderFrame: stranger.mainFrame }), /访问被拒绝/);
  await service.dispose(); assert.equal(service.sessions.size, 0);

  const retry = new context.MediaService({}, {}, () => ({ webContents: owner }));
  fail = true; retry.prepare(owner); pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retry.prepared.size, 0); assert.equal(retry.sessions.size, 0);
  fail = false; const recovered = create(); pending.shift()(); await recovered;
  await retry.dispose();

  const closing = new context.MediaService({}, {}, () => ({ webContents: owner }));
  closing.prepare(owner); const disposing = closing.dispose(); pending.shift()(); await disposing;
  assert.equal(closing.sessions.size, 0); assert.equal(closing.prepared.size, 0);

  const abandoned = new context.MediaService({}, {}, () => ({ webContents: owner }));
  abandoned.prepare(owner); owner.emit('destroyed'); pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(abandoned.sessions.size, 0); assert.equal(abandoned.prepared.size, 0);
  console.log('MEDIA_SERVICE_PREWARM_TEST_PASSED');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
