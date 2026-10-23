const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CURATED, createStore, resolveModel, isPerCallBanana21, shortModelName } = require('../plugin/model-manager');

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: key => data.delete(key)
  };
}

test('recommended image models default to cheap-to-expensive and include Banana 2.1', () => {
  assert.deepEqual(CURATED.map(model => model.id), ['tt-image-2.5','tt-image-2','banana-2.1','banana-2','banana-pro','doubao-seedream-5-0-pro-260628','gk-image-2.0']);
  const pro = CURATED.findIndex(model => model.id === 'banana-pro');
  assert.ok(CURATED.findIndex(model => model.id === 'banana-2.1') < CURATED.findIndex(model => model.id === 'banana-2'));
  assert.ok(CURATED.findIndex(model => model.id === 'doubao-seedream-5-0-pro-260628') > pro);
  assert.ok(CURATED.findIndex(model => model.id === 'gk-image-2.0') > pro);
  assert.equal(CURATED.find(model => model.id === 'doubao-seedream-5-0-pro-260628').price, '0.3024/次');
  assert.equal(shortModelName({ id: 'banana-2.1' }), 'Banana 2.1');
  assert.equal(shortModelName({ id: 'gk-image-2.0' }), 'Grok 图');
  const store = createStore([], { localStorage: memory() });
  assert.deepEqual(store.dropdown().models.map(model => model.id), CURATED.map(model => model.id));
  assert.deepEqual(store.state.selected, CURATED.map(model => model.id));
});

test('an existing selection gains Banana 2.1 once, in price order', () => {
  const localStorage = memory({
    'lk888-model-curated-v1': '1',
    'lk888-model-curated-v2': '1',
    'lk888-model-selected': JSON.stringify(['tt-image-2.5','tt-image-2','banana-2','banana-pro','doubao-seedream-5-0-pro-260628','gk-image-2.0'])
  });
  const store = createStore([], { localStorage });
  assert.deepEqual(store.state.selected, ['tt-image-2.5','tt-image-2','banana-2.1','banana-2','banana-pro','doubao-seedream-5-0-pro-260628','gk-image-2.0']);
  store.tick('banana-2.1', false);
  const again = createStore([], { localStorage });
  assert.equal(again.state.selected.filter(id => id === 'banana-2.1').length, 0);
});

test('Banana 2.1 stays in the dropdown after other models are tested', () => {
  const store = createStore([], { localStorage: memory() });
  store.setResult('banana-2', { ok: true, text: 'ok' });
  assert.ok(store.dropdown().models.some(model => model.id === 'banana-2.1'));
  store.setResult('banana-2.1', { ok: false, text: '平台暂时没返回' });
  assert.ok(store.dropdown().models.some(model => model.id === 'banana-2.1'));
  store.add({ id: 'my-extra', label: 'my-extra' }, { tick: true });
  store.setResult('my-extra', { ok: false, text: 'no' });
  assert.ok(!store.dropdown().models.some(model => model.id === 'my-extra'));
});

test('platform sync does not import the full catalog or billing variants', () => {
  const store = createStore([], { localStorage: memory() });
  const result = store.syncFromPlatform([
    { id: 'banana-2.1' },
    { id: 'banana-2.1-token' },
    { id: 'banana-2.1-flare' },
    { id: 'banana-2.1-sunburst' },
    { id: 'chat-model' },
    { id: 'gk-image-2.0-token' }
  ]);
  assert.equal(result.added, 0);
  assert.equal(result.found, 1);
  assert.equal(store.state.candidates.length, CURATED.length);
  assert.ok(!store.state.candidates.some(model => /token|flare|sunburst|chat-model/.test(model.id)));
  assert.equal(store.state.candidates.find(model => model.id === 'banana-2.1').platform, true);
  assert.equal(resolveModel('banana-2.1', [{ id: 'banana-2.1-token' }, { id: 'banana-2.1-flare' }, { id: 'banana-2.1-sunburst' }]), null);
  assert.equal(resolveModel('banana-2.1', [{ id: 'banana-2.1' }, { id: 'banana-2.1-token' }]).id, 'banana-2.1');
  assert.equal(resolveModel('gemini-nano-banana-2.1', [{ id: 'banana-2.1-flare' }, { id: 'banana-2.1' }]).id, 'banana-2.1');
  assert.equal(isPerCallBanana21('banana-2.1-token'), false);
  assert.equal(isPerCallBanana21('banana-2.1-flare'), false);
  assert.equal(isPerCallBanana21('banana-2.1-sunburst'), false);
  assert.equal(isPerCallBanana21('banana-2.1'), true);
});
