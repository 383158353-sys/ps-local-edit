const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MediaClient, imageSources } = require('../plugin/api');

test('image editing submits the source and references through LK888 media protocol', async () => {
  const calls = [];
  const api = new MediaClient('test-key', async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ data: { task_id: 'task-1' } }) }; });
  assert.equal(await api.submit('banana-2', '修改衣服', ['data:image/jpeg;base64,YQ==', 'data:image/png;base64,Yg==']), 'task-1');
  assert.equal(calls[0].url, 'https://api.lk888.ai/v1/media/generate');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'banana-2', prompt: '修改衣服', params: { images: ['data:image/jpeg;base64,YQ==', 'data:image/png;base64,Yg=='] } });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('an ambiguous submission failure is not retried', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; throw new Error('network lost'); });
  await assert.rejects(api.submit('tt-image-2', 'edit', ['source']), /提交生图任务.*勿重复生成/);
  assert.equal(count, 1);
});

test('status resumes the same task using GET and URL encoding', async () => {
  let call;
  const api = new MediaClient('test-key', async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ is_final: true, state: 'success' }) }; });
  await api.status('id a/b');
  assert.equal(call.url, 'https://api.lk888.ai/v1/media/status?task_id=id%20a%2Fb');
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.body, undefined);
});

test('recognizes nested URL, serialized result arrays, base64 and Gemini inline images', () => {
  assert.deepEqual(imageSources({ data: { result_url: '["https://img.example/a.png"]', images: [{ url: 'https://img.example/b.png' }], b64_json: 'YWJj', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'eHl6' } }] } }), ['https://img.example/a.png', 'https://img.example/b.png', 'data:image/png;base64,YWJj', 'data:image/jpeg;base64,eHl6']);
  assert.deepEqual(imageSources({ output_url: 'http://unsafe.example/a.png' }), []);
});

test('reports authentication errors without returning secret values', async () => {
  const api = new MediaClient('test-key', async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid key' } }) }));
  await assert.rejects(api.balance(), /Invalid key/);
});

test('reads actual API model ids from the authenticated models endpoint', async () => {
  let call;
  const api = new MediaClient('test-key', async (url, options) => {call={url,options};return {ok:true,json:async()=>({data:[{id:'seedream-edit'}, {id:'banana-2'}]})};});
  assert.deepEqual((await api.models()).map(m=>m.id), ['seedream-edit','banana-2']);
  assert.equal(call.url,'https://api.lk888.ai/v1/models');
  assert.equal(call.options.method,'GET');
});
