const assert = require('node:assert/strict');
const { test } = require('node:test');
const { collectDroppedImages, WECHAT_DROP_HINT } = require('../plugin/drop-images');

const png = { name: 'folder.png', type: 'image/png', size: 4 };
const tenMb = 10 * 1024 * 1024;

test('files are used before items and uxpEntries', async () => {
  let reads = 0;
  const { images, notice } = await collectDroppedImages({
    files: [png],
    items: [{ kind: 'file', getAsFile: () => ({ name: 'other.jpg', type: 'image/jpeg', size: 1 }) }],
    uxpEntries: [{ name: 'native.png' }],
    getData() { reads++; return 'file:///C:/ignored.png'; }
  }, { readLocalFile: async () => { reads++; return null; } });
  assert.equal(notice, null);
  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'folder.png');
  assert.equal(reads, 0);
});

test('items-only drop accepts an empty MIME when the extension matches', async () => {
  const { images, notice } = await collectDroppedImages({
    files: [],
    items: [{ kind: 'file', getAsFile: () => ({ name: '参考.jpg', type: '', size: 8 }) }, { kind: 'string', getAsFile: () => null }]
  });
  assert.equal(notice, null);
  assert.equal(images[0].name, '参考.jpg');
});

test('blank file placeholders fall through to uxpEntries and getFiles', async () => {
  const fromEntries = await collectDroppedImages({
    files: [{ name: '', type: '', size: 0 }],
    items: [],
    uxpEntries: [{ name: '目录', isFolder: true }, { name: 'explorer.png', nativePath: 'C:/pics/explorer.png' }]
  });
  assert.equal(fromEntries.images[0].name, 'explorer.png');
  const fromGetFiles = await collectDroppedImages({
    files: [],
    items: [],
    uxpEntries: [],
    getFiles: () => [{ name: 'late.webp', type: '', size: 3 }]
  });
  assert.equal(fromGetFiles.notice, null);
  assert.equal(fromGetFiles.images[0].name, 'late.webp');
});

test('async getFiles still reads uri-list synchronously and prefers the files', async () => {
  let sawUri = false;
  const pending = collectDroppedImages({
    files: [],
    items: [],
    getFiles: () => new Promise(resolve => setTimeout(() => resolve([{ name: 'async.png', type: 'image/png', size: 2 }]), 10)),
    getData(type) { sawUri = type === 'text/uri-list'; return 'file:///C:/fallback.png'; }
  }, { readLocalFile: async () => { throw new Error('should prefer getFiles'); } });
  assert.equal(sawUri, true);
  const collected = await pending;
  assert.equal(collected.images[0].name, 'async.png');
});

test('empty transfer tells the user to save from WeChat or paste', async () => {
  const collected = await collectDroppedImages({ files: [], items: [], uxpEntries: [], getData: () => 'https://weixin.qq.com/a.png' });
  assert.deepEqual(collected.images, []);
  assert.equal(collected.notice, WECHAT_DROP_HINT);
  assert.match(collected.notice, /另存/);
  assert.match(collected.notice, /粘贴/);
});

test('safe file uri is read and a remote uri is not', async () => {
  const reads = [];
  const local = await collectDroppedImages({
    files: [],
    items: [],
    getData: () => 'file:///C:/pics/local%20shot.png'
  }, { readLocalFile: async uri => { reads.push(uri); return { name: 'local shot.png', type: '', size: 4 }; } });
  assert.equal(local.images[0].name, 'local shot.png');
  assert.match(reads[0], /^file:\/\/\/C:\/pics\/local%20shot\.png$/);
  let remoteReads = 0;
  const remote = await collectDroppedImages({
    files: [{ name: '', type: '', size: 0 }],
    getData: () => 'https://example.com/a.png'
  }, { readLocalFile: async () => { remoteReads++; return null; } });
  assert.equal(remoteReads, 0);
  assert.equal(remote.notice, WECHAT_DROP_HINT);
});

test('mixed, oversized, and unsupported files add nothing', async () => {
  const mixed = await collectDroppedImages({ files: [png, { name: 'note.txt', type: 'text/plain', size: 1 }] });
  assert.deepEqual(mixed.images, []);
  assert.match(mixed.notice, /PNG、JPG 或 WebP/);
  const huge = await collectDroppedImages({ files: [{ name: 'big.png', type: '', size: tenMb + 1 }] });
  assert.deepEqual(huge.images, []);
  assert.match(huge.notice, /10MB/);
  const exact = await collectDroppedImages({ files: [{ name: 'ok.webp', type: 'application/octet-stream', size: tenMb }] });
  assert.equal(exact.notice, null);
  assert.equal(exact.images[0].name, 'ok.webp');
  const gif = await collectDroppedImages({ files: [{ name: 'anim.gif', type: 'image/gif', size: 4 }] });
  assert.deepEqual(gif.images, []);
});
