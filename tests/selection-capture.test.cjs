const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPs({ selectionBounds } = {}) {
  const calls = [];
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
    async batchPlay(descriptors, options) {
      calls.push({ inModal, synchronousExecution: options && options.synchronousExecution, obj: descriptors[0]._obj, property: descriptors[0]._target && descriptors[0]._target[0] && descriptors[0]._target[0]._property });
      return [{ selection: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } }];
    }
  };
  const pixels = new Uint8Array(bounds.width * bounds.height * 4);
  const mask = new Uint8Array(bounds.width * bounds.height);
  const imaging = {
    async getSelection() {
      return { sourceBounds: { ...bounds }, imageData: { width: bounds.width, height: bounds.height, getData: async () => mask } };
    },
    async getPixels() {
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
  return { api: module.exports, calls, capture: () => module.exports.captureSelection('copyMerged', false, false, { tight: true, padding: 0, ...(selectionBounds ? { selectionBounds } : {}) }) };
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
