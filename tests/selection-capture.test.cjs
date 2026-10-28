const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPs({ selectionBounds, maskBytes, batchPlayImpl } = {}) {
  const calls = [];
  const order = [];
  let inModal = false;
  const doc = {
    id: 7,
    name: 'pack.psd',
    path: 'C:/art/pack.psd',
    width: 1000,
    height: 800,
    resolution: 72,
    bitsPerChannel: 8,
    colorProfileName: 'sRGB IEC61966-2.1',
    mode: 'RGB',
    activeLayers: [],
    selection: { bounds: { left: 10, top: 20, right: 30, bottom: 50 } }
  };
  const bounds = { left: 10, top: 20, right: 30, bottom: 50, width: 20, height: 30 };
  const action = {
    batchPlay(descriptors, options) {
      calls.push({ inModal, synchronousExecution: !!(options && options.synchronousExecution), obj: descriptors[0]._obj, property: descriptors[0]._target && descriptors[0]._target[0] && descriptors[0]._target[0]._property });
      if (batchPlayImpl) return batchPlayImpl(descriptors, options);
      return [{ selection: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } }];
    }
  };
  const pixels = new Uint8Array(bounds.width * bounds.height * 4);
  const mask = maskBytes || new Uint8Array(bounds.width * bounds.height);
  const imaging = {
    async getSelection() {
      order.push('getSelection');
      return { sourceBounds: { ...bounds }, imageData: { width: bounds.width, height: bounds.height, getData: async () => mask, dispose() { order.push('dispose'); } } };
    },
    async getPixels() {
      order.push('getPixels');
      return { sourceBounds: { ...bounds }, imageData: { width: bounds.width, height: bounds.height, components: 4, getData: async () => pixels } };
    }
  };
  const core = {
    async executeAsModal(callback) {
      inModal = true;
      try {
        return await callback({ hostControl: { suspendHistory: async () => 1, resumeHistory: async () => {} } });
      } finally { inModal = false; }
    }
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'modules', 'ps.js'), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, console,
    require(name) {
      if (name === 'photoshop') return { app: { activeDocument: doc, documents: { length: 1 } }, action, core, imaging, constants: {} };
      if (name === './geometry.js') return require('../plugin/modules/geometry');
      if (name === './settings.js') return {};
      throw new Error('Unexpected import: ' + name);
    }
  }, { filename: 'ps.js' });
  return { api: module.exports, calls, order, core, capture: () => module.exports.captureSelection('copyMerged', false, false, { tight: true, padding: 0, ...(selectionBounds ? { selectionBounds } : {}) }) };
}

test('prefetched selection bounds are not read again with async batchPlay inside the modal', async () => {
  const { calls, capture } = loadPs({ selectionBounds: { left: 10, top: 20, width: 20, height: 30 } });
  const result = await capture();
  assert.equal(calls.length, 0);
  assert.equal(result.bounds.width, 20);
  assert.equal(result.bounds.height, 30);
  assert.equal(result.imageData.imageData.width, 20);
});

test('selection geometry batchPlay stays outside executeAsModal', async () => {
  const { calls, capture } = loadPs();
  const result = await capture();
  assert.ok(calls.length >= 1);
  assert.ok(calls.every(call => call.inModal === false));
  assert.equal(result.context.originalBounds.left, 10);
  assert.equal(result.context.originalBounds.top, 20);
});

test('mask image data is released before getPixels', async () => {
  const { order, capture } = loadPs({ selectionBounds: { left: 10, top: 20, width: 20, height: 30 } });
  await capture();
  assert.deepEqual(order, ['getSelection', 'dispose', 'getPixels']);
});

test('a large all-white mask still counts as select all and a dark pixel does not', async () => {
  const mask = new Uint8Array(400000);
  mask.fill(255);
  const white = loadPs({ selectionBounds: { left: 10, top: 20, width: 20, height: 30 }, maskBytes: mask });
  const selected = await white.capture();
  assert.equal(selected.isSelectAll, true);
  mask[0] = 0;
  const punched = loadPs({ selectionBounds: { left: 10, top: 20, width: 20, height: 30 }, maskBytes: mask });
  const partial = await punched.capture();
  assert.equal(partial.isSelectAll, false);
});

test('select-all check samples a large mask instead of visiting every pixel', () => {
  const { api } = loadPs();
  const length = 800000;
  const reads = new Set();
  const buffer = new Proxy({ length }, {
    get(target, prop) {
      if (prop === 'length') return length;
      const index = Number(prop);
      if (Number.isInteger(index) && index >= 0 && index < length) {
        reads.add(index);
        return 255;
      }
      return target[prop];
    }
  });
  assert.equal(api.maskLooksSelectAll(buffer), true);
  assert.ok(reads.size > 0);
  assert.ok(reads.size <= 262146);
  assert.ok(reads.size < length);
});

test('selection bounds use the sync batchPlay result when the async form would never return', async () => {
  const loaded = loadPs({
    batchPlayImpl(descriptors, options) {
      if (!(options && options.synchronousExecution)) return new Promise(() => {});
      return [{ selection: { left: 10, top: 20, right: 30, bottom: 50 } }];
    }
  });
  const bounds = await Promise.race([
    loaded.core.executeAsModal(() => loaded.api.getSelectionBounds()),
    new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 300))
  ]);
  assert.equal(bounds.width, 20);
  assert.equal(bounds.height, 30);
  assert.ok(loaded.calls.length >= 1);
  assert.ok(loaded.calls.every(call => call.inModal === true && call.synchronousExecution === true));
});

test('selection bounds fall back to async batchPlay outside a modal', async () => {
  const loaded = loadPs({
    batchPlayImpl(descriptors, options) {
      if (options && options.synchronousExecution) throw new Error('synchronousExecution is only available inside a modal scope');
      return [{ selection: { left: 4, top: 6, right: 14, bottom: 18 } }];
    }
  });
  const bounds = await loaded.api.getSelectionBounds();
  assert.equal(bounds.width, 10);
  assert.equal(bounds.height, 12);
  assert.ok(loaded.calls.some(call => call.synchronousExecution === false && call.inModal === false));
});
