const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MODELS, MediaClient, imageSources, generateTimeouts } = require('../plugin/api');
const { TaskQueue } = require('../plugin/task-queue');

test('completed status with image becomes a candidate without placing a layer', async () => {
  for (const state of ['SUCCESS','completed','succeeded']) {
    const task={id:'existing',state:'running',results:[]};
    const job={id:'job',state:'running',tasks:[task]};
    const queue=new TaskQueue({jobs:[job],persist:()=>{},onChange:()=>{},client:async()=>({status:async()=>({data:{state,output:{images:[{url:'https://img.example/result.png'}]}}})})});
    await queue.tick();
    assert.equal(task.state,'ready');
    assert.deepEqual(task.results,[{source:'https://img.example/result.png',imported:false}]);
  }
});

test('lists the per-call image models from cheap to expensive, including Banana 2.1', () => {
  assert.deepEqual(MODELS.map(model => model.id), ['tt-image-2.5','tt-image-2','banana-2.1','banana-2','banana-pro','doubao-seedream-5-0-pro-260628','gk-image-2.0','custom']);
  const pro=MODELS.findIndex(model=>model.id==='banana-pro');
  assert.ok(MODELS.findIndex(model=>model.id==='doubao-seedream-5-0-pro-260628')>pro);
  assert.ok(MODELS.findIndex(model=>model.id==='gk-image-2.0')>pro);
  assert.equal(MODELS.find(model=>model.id==='banana-2.1').label,'Banana 2.1');
});

test('submits selected third-party image model ids unchanged', async () => {
  const calls = [];
  const api = new MediaClient('test-key', async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ task_id: 'task-1' }) }; });
  for (const model of ['doubao-seedream-5-0-pro-260628','gk-image-2.0','qwen-image-max']) await api.submit(model, '编辑图片', ['data:image/png;base64,YQ==']);
  assert.deepEqual(calls.map(call => call.model), ['doubao-seedream-5-0-pro-260628','gk-image-2.0','qwen-image-max']);
});

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

test('explains LK888 gateway 502 without resubmitting the image task', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; return { ok: false, status: 502, json: async () => ({}) }; });
  await assert.rejects(api.submit('gk-image-2.0', '编辑图片', ['source']), /上游模型返回 502/);
  assert.equal(count, 1);
});
test('HTTP 200 business errors show the provider reason instead of a misleading status', async () => {
  const api = new MediaClient('test-key', async () => ({ok:true,status:200,json:async()=>({error:{msg:'模型不支持上传图片'}})}));
  await assert.rejects(api.submit('banana-2','测试',['data:image/png;base64,YQ==']),/模型不支持上传图片/);
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
  assert.deepEqual(imageSources({ output_url: 'http://img.example/a.png' }), ['http://img.example/a.png']);
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

test('recognizes serialized result containers and alternate image fields without leaking unrelated URLs',()=>{
 assert.deepEqual(imageSources({data:{result:JSON.stringify({outputs:[{uri:'http://cdn.example/a.png'},{download_url:'https://cdn.example/b.png'}]})},images:['https://cdn.example/b.png'],metadata:{url:'https://cdn.example/meta'},message:'https://cdn.example/help'}),['http://cdn.example/a.png','https://cdn.example/b.png']);
 assert.deepEqual(imageSources({data:{output:JSON.stringify(['https://cdn.example/one.png']),result_urls:['https://cdn.example/two.png'],generated_images:[{src:'https://cdn.example/three.png'}]}}),['https://cdn.example/one.png','https://cdn.example/two.png','https://cdn.example/three.png']);
 assert.deepEqual(imageSources({result:'not json',url:'javascript:alert(1)',image_url:'https://user:password@cdn.example/private',base64:'bad value',error:{message:'https://cdn.example/error'}}),[]);
});

test('generate waits longer than the old five minute abort and scales with reference images', () => {
  const small = generateTimeouts('/v1/media/generate', { model: 'banana-2', prompt: '短', params: { images: [] } });
  const large = generateTimeouts('/v1/media/generate', { model: 'banana-2', prompt: 'x'.repeat(8000), params: { images: ['data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024)] } });
  assert.ok(small.headersMs >= 8 * 60 * 1000);
  assert.ok(small.headersMs > 300000);
  assert.ok(large.headersMs > small.headersMs);
  assert.ok(large.headersMs <= 15 * 60 * 1000);
  assert.equal(small.bodyMs, 90 * 1000);
  assert.equal(generateTimeouts('/v1/media/status?task_id=1', null).headersMs, 60000);
});

test('generate posts to LK888 even when the client uses global fetch', async () => {
  const original = global.fetch;
  let call;
  global.fetch = async (url, options) => { call = { url, options }; return { ok: true, status: 200, json: async () => ({ task_id: 'direct-task' }) }; };
  try {
    const api = new MediaClient('test-key');
    assert.equal(await api.submit('banana-2', '改衣服', ['data:image/png;base64,YQ==']), 'direct-task');
  } finally { global.fetch = original; }
  assert.equal(call.url, 'https://api.lk888.ai/v1/media/generate');
  assert.equal(call.options.headers.Authorization, 'Bearer test-key');
  assert.equal(call.options.headers['X-PS-Local-Voice'], undefined);
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'banana-2');
  assert.equal(body.key, undefined);
  assert.deepEqual(body.params.images, ['data:image/png;base64,YQ==']);
});

test('banana 2.1 is submitted as the per-call id without a model lookup', async () => {
  const calls = [];
  const api = new MediaClient('test-key', async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, status: 200, json: async () => ({ task_id: 'b21' }) }; });
  assert.equal(await api.submit('banana-2.1', '换成图2的人', ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==']), 'b21');
  assert.deepEqual(calls.map(call => call.url), ['https://api.lk888.ai/v1/media/generate']);
  assert.equal(calls[0].body.model, 'banana-2.1');
  assert.equal(calls[0].body.params.images.length, 2);
});

test('connection refused is not an uncertain task and is retried only a few times', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; const error = new TypeError('connect ECONNREFUSED'); error.cause = { code: 'ECONNREFUSED' }; throw error; }, { retryDelays: [0, 0] });
  await assert.rejects(api.submit('banana-2', 'edit', ['data:image/png;base64,YQ==']), error => error.notSubmitted === true && /没有发出/.test(error.message) && /可以重新生成/.test(error.message) && !/勿重复生成/.test(error.message));
  assert.equal(count, 3);
});

test('a refused connection that later succeeds keeps the task id', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; if (count === 1) { const error = new TypeError('getaddrinfo ENOTFOUND api.lk888.ai'); error.code = 'ENOTFOUND'; throw error; } return { ok: true, status: 200, json: async () => ({ data: { task_id: 'after-retry' } }) }; }, { retryDelays: [0, 0] });
  assert.equal(await api.submit('banana-2', 'edit', ['data:image/png;base64,YQ==']), 'after-retry');
  assert.equal(count, 2);
});

test('aborting an in-flight generate is uncertain and is not retried', async () => {
  let count = 0;
  const api = new MediaClient('test-key', (_url, options) => new Promise((_, reject) => { count++; options.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))); }), { timeouts: { headersMs: 30, bodyMs: 30 }, retryDelays: [0, 0] });
  await assert.rejects(api.submit('banana-2', '很长的修改要求', ['data:image/png;base64,' + 'A'.repeat(2000)]), /提交生图任务.*勿重复生成/);
  assert.equal(count, 1);
});

test('a dropped body after response headers does not retry the submission', async () => {
  let count = 0;
  const api = new MediaClient('test-key', (_url, options) => { count++; return Promise.resolve({ ok: true, status: 200, json: () => new Promise((_, reject) => { options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) }); }, { timeouts: { headersMs: 1000, bodyMs: 20 }, retryDelays: [0, 0] });
  await assert.rejects(api.submit('banana-2', 'x', []), error => error.uncertain === true && /勿重复生成/.test(error.message));
  assert.equal(count, 1);
});

test('provider timeout text is not rewritten into an uncertain network failure', async () => {
  let count = 0;
  const api = new MediaClient('test-key', async () => { count++; return { ok: true, status: 200, json: async () => ({ error: { message: 'upstream timeout while sampling' } }) }; });
  await assert.rejects(api.submit('banana-2', 'x', ['source']), /upstream timeout while sampling/);
  assert.equal(count, 1);
});

test('a task id included with an error response is kept', async () => {
  const api = new MediaClient('test-key', async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'busy' }, task_id: 'kept-1' }) }));
  await assert.rejects(api.submit('banana-2', 'x', []), error => error.taskId === 'kept-1' && /busy/.test(error.message) && error.uncertain !== true);
});

test('legacy banana placeholder submits the per-call id and ignores billing variants', async () => {
  const bodies = [];
  const blocked = new MediaClient('test-key', async url => { if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'banana-2.1-token' }, { id: 'banana-2.1-flare' }, { id: 'banana-2.1-sunburst' }] }) }; return { ok: true, status: 200, json: async () => ({ task_id: 'nope' }) }; });
  await assert.rejects(blocked.submit('gemini-nano-banana-2.1', 'x', []), error => error.terminal === true && /尚未提交/.test(error.message));
  const api = new MediaClient('test-key', async (url, options) => { if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'banana-2.1-token' }, { id: 'banana-2.1' }] }) }; bodies.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ task_id: 'ok-b21' }) }; });
  assert.equal(await api.submit('gemini-nano-banana-2.1', 'x', []), 'ok-b21');
  assert.equal(bodies[0].model, 'banana-2.1');
});

test('status failures stay queryable and do not claim the submission is uncertain', async () => {
  const api = new MediaClient('test-key', () => Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), { timeouts: { headersMs: 20, bodyMs: 20 } });
  await assert.rejects(api.status('task-1'), error => /查询原任务/.test(error.message) && /不会重复提交/.test(error.message) && !/勿重复生成/.test(error.message));
});
